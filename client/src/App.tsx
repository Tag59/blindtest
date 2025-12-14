import { useEffect, useState, useRef } from 'react';
// @ts-ignore
import io from 'socket.io-client';
// @ts-ignore
import YouTube from 'react-youtube';
import Confetti from 'react-confetti';
import { createAvatar } from '@dicebear/core';
import { lorelei } from '@dicebear/collection';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const socket = io(SOCKET_URL);

type Player = { id: string; userId: string; username: string; score: number; avatarUrl: string };
type ChatMessage = { type: 'user' | 'system' | 'success'; username?: string; text: string };

// AVATARS : Couleurs de fond neutres (niveaux de gris) pour être plus sobres
const getAvatar = (seed: string) => {
  const avatar = createAvatar(lorelei, { seed, size: 64, backgroundColor: ['e5e7eb','d1d5db','9ca3af'] });
  return avatar.toDataUri();
};

const getUserId = () => {
    let id = localStorage.getItem('blindtest_userid');
    if (!id) {
        id = Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('blindtest_userid', id);
    }
    return id;
};

function App() {
  const [username, setUsername] = useState(localStorage.getItem('blindtest_username') || "");
  const [room, setRoom] = useState(localStorage.getItem('blindtest_room') || "");
  const [userId] = useState(getUserId());
  const [isInRoom, setIsInRoom] = useState(false);
  const [volume, setVolume] = useState(50);
  
  const [gameState, setGameState] = useState("PREP"); 
  const [players, setPlayers] = useState<Player[]>([]);
  const [playlistSize, setPlaylistSize] = useState(0);
  const [isMyTurnToWait, setIsMyTurnToWait] = useState(false);
  const [hasFound, setHasFound] = useState(false);

  const [videoId, setVideoId] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [inputText, setInputText] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
  useEffect(() => { if(playerRef.current) { playerRef.current.setVolume(volume); } }, [volume]);

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);

    socket.on("room_state_update", (data: any) => {
        const playersWithAvatars = data.players.map((p:any) => ({...p, avatarUrl: getAvatar(p.username)}));
        setPlayers(playersWithAvatars);
        setGameState(data.status);
        setPlaylistSize(data.playlistSize);
        
        const me = data.players.find((p:any) => p.userId === userId);
        if (me && !isInRoom) setIsInRoom(true);

        if (data.status === 'PREP') {
            setVideoId("");
            setChatMessages([]);
            setHasFound(false);
            setSearchResults([]);
            setSearchQuery("");
            setShowConfetti(false);
        }
    });

    socket.on("chat_message", (msg: ChatMessage) => { setChatMessages(prev => [...prev, msg]); });

    socket.on("play_song", (data: any) => {
      setGameState("PLAYING");
      setVideoId(data.videoId);
      setStartTime(data.startTime);
      setHasFound(false);
      setInputText("");
      setShowConfetti(false);
      
      if (data.ownerId === userId) {
          setIsMyTurnToWait(true);
      } else {
          setIsMyTurnToWait(false);
          setTimeout(() => inputRef.current?.focus(), 100);
      }
    });

    socket.on("guess_feedback", (data: any) => {
        setHasFound(true); 
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
    });

    socket.on("round_ended", (data: any) => {
        setGameState("ROUND_END");
        setIsMyTurnToWait(false);
        setChatMessages(prev => [...prev, { type: 'system', text: `La réponse était : ${data.answer}` }]);
        const playersWithAvatars = data.players.map((p:any) => ({...p, avatarUrl: getAvatar(p.username)}));
        setPlayers(playersWithAvatars.sort((a:any, b:any) => b.score - a.score));
    });

    socket.on("game_finished", (finalPlayers: any) => {
        setGameState("FINISHED");
        setVideoId("");
        setShowConfetti(true);
        const playersWithAvatars = finalPlayers.map((p:any) => ({...p, avatarUrl: getAvatar(p.username)}));
        setPlayers(playersWithAvatars.sort((a:any, b:any) => b.score - a.score));
    });

    return () => {
      socket.off("room_state_update"); socket.off("play_song"); socket.off("guess_feedback");
      socket.off("round_ended"); socket.off("game_finished"); socket.off("chat_message");
    };
  }, [userId, isInRoom]);

  const joinRoom = () => {
    if (room && username) {
      localStorage.setItem('blindtest_username', username);
      localStorage.setItem('blindtest_room', room);
      socket.emit("join_room", { room: room.toUpperCase(), username, userId });
    }
  };

  const handleSearch = async (e: any) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
        const response = await fetch(`${SOCKET_URL}/api/search?q=${searchQuery}`);
        const data = await response.json();
        setSearchResults(data);
    } catch (error) { console.error(error); alert("Erreur recherche"); }
  };

  const addSongToPlaylist = (song: any) => {
      socket.emit("add_song_to_playlist", { room: room.toUpperCase(), videoId: song.videoId, title: song.title });
      setSearchQuery("");
      setSearchResults([]);
  };

  const startGame = () => { socket.emit("start_game_sequence", { room: room.toUpperCase() }); };
  const restartGame = () => { socket.emit("restart_game", { room: room.toUpperCase() }); };

  const sendGuessOrChat = (e: any) => {
    e.preventDefault();
    if(inputText) { socket.emit("submit_guess", { room: room.toUpperCase(), guess: inputText }); setInputText(""); }
  };

  const opts = { height: '100%', width: '100%', playerVars: { autoplay: 1, start: startTime, controls: 0, disablekb: 1 } };
  const onReady = (event: any) => { playerRef.current = event.target; event.target.setVolume(volume); };

  // Couleurs de confettis plus sobres (Bleu, Blanc, Or)
  const confettiColors = ['#3b82f6', '#ffffff', '#fbbf24'];

  return (
    // Fond sombre uni, fini les dégradés complexes
    <div className="min-h-screen font-sans flex flex-col items-center relative bg-slate-900 text-gray-100 overflow-hidden">
      {showConfetti && <Confetti width={windowSize.width} height={windowSize.height} colors={confettiColors} />}

      {/* HEADER ÉPURÉ */}
      <header className="w-full p-4 flex justify-between items-center glass-card rounded-none border-t-0 border-x-0 z-20 bg-slate-800/50">
         {/* Titre Blanc, simple et fort */}
         <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight truncate">
            BestBlindTestEver.
         </h1>
         {isInRoom && (
             <div className="flex items-center gap-4">
                 <div className="flex items-center gap-2 bg-slate-700/50 px-3 py-1 rounded-full border border-white/10">
                     <span className="text-xs text-gray-400">🔊</span>
                     {/* Slider bleu */}
                     <input 
                        type="range" min="0" max="100" value={volume} 
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="w-20 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                     />
                 </div>
                 <div className="text-sm font-medium text-gray-300 hidden md:block">Salle: <span className="text-white font-bold">{room}</span></div>
             </div>
         )}
      </header>

      {/* TIMER BAR : Bleu unique, simple */}
      {gameState === 'PLAYING' && (
          <div className="w-full h-1 fixed top-[64px] z-20 bg-slate-800">
              <div className="h-full bg-blue-500 animate-timer-smooth origin-left"></div>
          </div>
      )}

      <main className="flex-1 w-full max-w-6xl p-4 flex flex-col relative z-10 pb-20">
        {!isInRoom ? (
          // LOGIN SOBRE
          <div className="flex-1 flex items-center justify-center">
            <div className="glass-card p-8 w-full max-w-md space-y-6 text-center">
              <h2 className="text-2xl font-bold text-white">Rejoindre la partie</h2>
              <input className="w-full glass-input rounded-xl px-4 py-3" placeholder="Ton Pseudo" value={username} onChange={(e) => setUsername(e.target.value)} />
              <input className="w-full glass-input rounded-xl px-4 py-3 uppercase font-bold" placeholder="CODE SALLE" value={room} onChange={(e) => setRoom(e.target.value)} />
              <button onClick={joinRoom} disabled={!username || !room} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed">C'EST PARTI</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row gap-6 h-full min-h-[70vh] mt-4">
            
            <div className="flex-1 flex flex-col gap-4">
                {/* 1. PREP MODE ÉPURÉ */}
                {gameState === 'PREP' && (
                    <div className="glass-card p-6 flex-1 flex flex-col">
                        <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                            <h2 className="text-lg font-bold text-white">🎧 Créer la Playlist</h2>
                            <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs font-bold border border-blue-500/30">{playlistSize} sons prêts</span>
                        </div>
                        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                            <input placeholder="Rechercher un titre..." className="flex-1 glass-input rounded-xl px-4 py-2" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                            <button className="bg-slate-700 hover:bg-slate-600 px-4 rounded-xl border border-white/10">🔍</button>
                        </form>
                        <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
                            {searchResults.map((video: any) => (
                                <div key={video.videoId} className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg cursor-pointer group transition" onClick={() => addSongToPlaylist(video)}>
                                    <img src={video.thumbnail} className="w-16 h-10 rounded object-cover grayscale group-hover:grayscale-0 transition" />
                                    <div className="overflow-hidden flex-1">
                                        <p className="text-sm font-medium truncate text-gray-200 group-hover:text-white">{video.title}</p>
                                    </div>
                                    <div className="text-blue-400 opacity-0 group-hover:opacity-100 font-bold px-3">+</div>
                                </div>
                            ))}
                        </div>
                        {playlistSize > 0 && (
                            <button onClick={startGame} className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-blue-900/20">LANCER LA PARTIE</button>
                        )}
                    </div>
                )}

                {/* 2. JEU & CHAT SOBRE */}
                {(gameState === 'PLAYING' || gameState === 'ROUND_END') && (
                    <div className="flex-1 flex flex-col gap-4 relative">
                        <div className="glass-card flex-1 p-4 overflow-y-auto no-scrollbar flex flex-col gap-3 max-h-[60vh] bg-slate-800/50">
                             {chatMessages.map((msg, i) => (
                                 <div key={i} className={`px-3 py-2 rounded-lg text-sm max-w-[90%] border ${
                                     msg.type === 'system' ? 'bg-slate-700/50 text-gray-300 border-transparent self-center text-center w-full italic' :
                                     msg.type === 'success' ? 'bg-green-500/10 text-green-400 font-bold self-center border-green-500/30' :
                                     'bg-slate-700 text-white self-start border-slate-600'
                                 }`}>
                                     {msg.username && <span className="font-bold text-blue-400 mr-2">{msg.username}</span>}
                                     {msg.text}
                                 </div>
                             ))}
                             <div ref={chatEndRef} />
                        </div>

                        {gameState === 'PLAYING' && !isMyTurnToWait && !hasFound && (
                            <form onSubmit={sendGuessOrChat} className="mt-auto">
                                <input ref={inputRef} value={inputText} onChange={(e) => setInputText(e.target.value)} 
                                    placeholder="Tape ta réponse..." 
                                    className="w-full glass-input rounded-full px-6 py-4 text-lg focus:border-blue-500 transition-all" 
                                />
                            </form>
                        )}

                        {isMyTurnToWait && gameState === 'PLAYING' && (
                             <div className="glass-card p-4 text-center bg-indigo-900/30 text-indigo-200 border-indigo-500/30 font-medium">
                                 🤫 C'est ton son, chut !
                             </div>
                        )}
                        {hasFound && gameState === 'PLAYING' && (
                             <div className="glass-card p-4 text-center bg-green-900/30 text-green-300 border-green-500/30 font-bold animate-pulse">
                                 ✅ Réponse trouvée !
                             </div>
                        )}
                    </div>
                )}
                
                {/* 3. FIN DE PARTIE SOBRE */}
                {gameState === 'FINISHED' && (
                    <div className="glass-card p-10 text-center flex-1 flex flex-col justify-center items-center">
                        <h1 className="text-3xl font-bold text-white mb-8">Podium Final 🏆</h1>
                        <button onClick={restartGame} className="bg-white text-slate-900 px-8 py-3 rounded-full font-bold hover:bg-gray-200 transition">
                            🔄 Rejouer
                        </button>
                    </div>
                )}
            </div>

            {/* DROITE : CLASSEMENT ÉPURÉ */}
            <div className="w-full md:w-80 glass-card p-4 h-fit max-h-[50vh] overflow-y-auto no-scrollbar order-first md:order-last bg-slate-800/80">
               <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 pl-2">Classement</h3>
               <ul className="space-y-2">
                  {players.map((player, index) => (
                    <li key={player.id} className={`flex items-center gap-3 p-2 rounded-lg border ${index === 0 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-slate-700/30 border-transparent'}`}>
                       <div className="relative">
                           <img src={player.avatarUrl} className="w-10 h-10 rounded-full bg-slate-600" />
                           {index === 0 && <span className="absolute -top-1 -right-1 text-sm">🥇</span>}
                       </div>
                       <div className="flex-1 overflow-hidden">
                           <p className={`font-medium truncate ${index === 0 ? 'text-yellow-200 font-bold' : 'text-gray-200'}`}>{player.username}</p>
                       </div>
                       <div className="font-mono font-bold text-lg">{player.score}</div>
                    </li>
                  ))}
               </ul>
            </div>

          </div>
        )}
      </main>

      {/* REVEAL VIDEO : Cadre plus sobre, ombre portée plus douce */}
      <div className={`transition-all duration-700 ease-in-out z-50 ${gameState === 'ROUND_END' ? 'fixed inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm' : 'fixed top-[-9999px]'}`}>
          <div className={`relative bg-black rounded-xl overflow-hidden shadow-2xl border border-white/10 ${gameState === 'ROUND_END' ? 'w-[90vw] max-w-3xl aspect-video scale-100 opacity-100' : 'scale-90 opacity-0'} transition-all duration-500`}>
              {videoId && <YouTube key={videoId} videoId={videoId} opts={opts} onReady={onReady} className="w-full h-full" />}
              {gameState === 'ROUND_END' && (
                  <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/70 to-transparent p-6 text-center">
                       <h2 className="text-xl font-bold text-white">C'était la réponse !</h2>
                  </div>
              )}
          </div>
      </div>
    </div>
  );
}

export default App;