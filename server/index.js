require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const stringSimilarity = require('string-similarity');
const he = require('he');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {}; 
const cleanupTimeouts = {}; 
let roundTimeout = null;
const ROUND_DURATION = 30;
let roundStartTime = 0;

// UTILS
function cleanString(str) {
    if (!str) return "";
    let decoded = he.decode(str);
    return decoded.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[\(\[].*?[\)\]]/g, "") 
        .replace(/official video/g, "").replace(/visualizer/g, "").replace(/officiel/g, "")
        .replace(/lyrics/g, "").replace(/clip/g, "").replace(/audio/g, "").replace(/ft\./g, "").replace(/feat/g, "")
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").replace(/['’]/g, " ").replace(/\s{2,}/g," ").trim();
}

function isGoodAnswer(userInput, youtubeTitle) {
    const cleanedInput = cleanString(userInput);
    const decodedTitle = he.decode(youtubeTitle);
    const parts = decodedTitle.split(/-|:|\|/).map(p => cleanString(p)).filter(p => p.length > 1);
    const possibleAnswers = [cleanString(youtubeTitle), ...parts];
    const matches = stringSimilarity.findBestMatch(cleanedInput, possibleAnswers);
    return matches.bestMatch.rating > 0.75; 
}

// GAME LOGIC
function playNextSong(roomName) {
    const room = rooms[roomName];
    if (!room || room.playlist.length === 0) return;

    if (room.currentSongIndex >= room.playlist.length) {
        room.status = 'FINISHED';
        io.to(roomName).emit('game_finished', room.players);
        return;
    }

    const song = room.playlist[room.currentSongIndex];
    const randomStart = Math.floor(Math.random() * 50) + 40;
    roundStartTime = Date.now();

    room.players.forEach(p => p.roundScore = 0);

    io.to(roomName).emit('chat_message', { type: 'system', text: `🎵 Manche ${room.currentSongIndex + 1}/${room.playlist.length}` });

    io.to(roomName).emit('play_song', {
        videoId: song.videoId,
        startTime: randomStart,
        ownerId: song.ownerId 
    });

    if (roundTimeout) clearTimeout(roundTimeout);
    roundTimeout = setTimeout(() => { endRound(roomName); }, ROUND_DURATION * 1000);
}

function endRound(roomName) {
    if (roundTimeout) clearTimeout(roundTimeout);
    const room = rooms[roomName];
    if (!room) return;

    const currentSong = room.playlist[room.currentSongIndex];
    room.players.forEach(p => { p.score += (p.roundScore || 0); });

    io.to(roomName).emit('round_ended', {
        answer: he.decode(currentSong.title),
        players: room.players
    });

    room.currentSongIndex++;
    setTimeout(() => { playNextSong(roomName); }, 8000);
}

// API SEARCH
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Vide" });
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { part: 'snippet', q: query, type: 'video', maxResults: 10, key: process.env.YOUTUBE_API_KEY }
    });
    const results = response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: he.decode(item.snippet.title),
      thumbnail: item.snippet.thumbnails.medium.url,
      channel: item.snippet.channelTitle
    }));
    res.json(results);
  } catch (error) { console.error(error); res.status(500).json({ error: "Erreur" }); }
});

// SOCKETS
io.on('connection', (socket) => {
  
  // 🔴 IMPORTANT : On récupère 'avatarUrl' ici
  socket.on('join_room', (data) => {
    const { room, username, userId, avatarUrl } = data; 
    socket.join(room);

    if (cleanupTimeouts[room]) {
        clearTimeout(cleanupTimeouts[room]);
        delete cleanupTimeouts[room];
    }
    
    if (!rooms[room]) {
        rooms[room] = { status: 'PREP', players: [], playlist: [], currentSongIndex: 0 };
    }

    const existingPlayer = rooms[room].players.find(p => p.userId === userId);

    if (existingPlayer) {
        // C'est une reconnexion
        existingPlayer.id = socket.id;
        existingPlayer.username = username;
        
        // 🔴 CRUCIAL : Si le joueur envoie un nouvel avatar, on met à jour !
        // Si avatarUrl est vide (bug), on garde l'ancien s'il existe.
        if (avatarUrl && avatarUrl.length > 0) {
            existingPlayer.avatarUrl = avatarUrl;
        }
    } else {
        // Nouveau joueur
        rooms[room].players.push({ 
            id: socket.id, 
            userId: userId, 
            username: username || "Anonyme", 
            // 🔴 CRUCIAL : On stocke l'avatar dès la création
            avatarUrl: avatarUrl || "", 
            score: 0, 
            roundScore: 0 
        });
    }
    
    io.to(room).emit('room_state_update', {
        players: rooms[room].players,
        status: rooms[room].status,
        playlistSize: rooms[room].playlist.length
    });
  });

  socket.on('add_song_to_playlist', (data) => {
      const room = rooms[data.room];
      const player = room?.players.find(p => p.id === socket.id);
      if (room && room.status === 'PREP' && player) {
          room.playlist.push({ videoId: data.videoId, title: data.title, ownerId: player.userId });
          io.to(data.room).emit('room_state_update', { players: room.players, status: room.status, playlistSize: room.playlist.length });
      }
  });

  socket.on('start_game_sequence', (data) => {
      const room = rooms[data.room];
      if (room && room.playlist.length > 0) {
          room.status = 'PLAYING';
          for (let i = room.playlist.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [room.playlist[i], room.playlist[j]] = [room.playlist[j], room.playlist[i]];
          }
          playNextSong(data.room);
      }
  });

  socket.on('submit_guess', (data) => {
    const room = rooms[data.room];
    if (!room || room.status !== 'PLAYING') return;

    const currentSong = room.playlist[room.currentSongIndex];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    
    if (player.userId === currentSong.ownerId || player.roundScore > 0) return; 

    if (isGoodAnswer(data.guess, currentSong.title)) {
        const timeElapsed = (Date.now() - roundStartTime) / 1000;
        const timeLeft = Math.max(0, ROUND_DURATION - timeElapsed);
        const points = 10 + Math.floor(timeLeft);
        player.roundScore = points;

        socket.emit('guess_feedback', { type: 'success', points: points });
        io.to(data.room).emit('chat_message', { type: 'success', text: `⚡ ${player.username} a trouvé !` });
        
        const guessers = room.players.filter(p => p.userId !== currentSong.ownerId);
        const allFound = guessers.every(p => p.roundScore > 0);
        if (allFound) endRound(data.room);
    } else {
        io.to(data.room).emit('chat_message', { type: 'user', username: player.username, text: data.guess });
    }
  });

  socket.on('restart_game', (data) => {
      const room = rooms[data.room];
      if (room) {
          room.status = 'PREP';
          room.playlist = [];
          room.currentSongIndex = 0;
          room.players.forEach(p => { p.score = 0; p.roundScore = 0; });
          io.to(data.room).emit('room_state_update', { players: room.players, status: room.status, playlistSize: 0 });
          io.to(data.room).emit('chat_message', { type: 'system', text: "🔄 Partie relancée !" });
      }
  });

  socket.on('disconnect', () => {
    for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room.players.find(p => p.id === socket.id)) {
            const connectedSockets = io.sockets.adapter.rooms.get(roomName);
            if (!connectedSockets || connectedSockets.size === 0) {
                console.log(`⚠️ Salle ${roomName} vide. Suppression dans 2 min...`);
                cleanupTimeouts[roomName] = setTimeout(() => {
                    delete rooms[roomName];
                    delete cleanupTimeouts[roomName];
                }, 2 * 60 * 1000);
            }
        }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => { console.log(`SERVER RUNNING ON PORT ${PORT}`); });