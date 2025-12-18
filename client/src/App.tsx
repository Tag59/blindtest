import { useEffect, useState, useRef } from 'react';
// @ts-ignore
import io from 'socket.io-client';
// @ts-ignore
import YouTube from 'react-youtube';
import Confetti from 'react-confetti';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const socket = io(SOCKET_URL);

type Player = { id: string; userId: string; username: string; score: number; avatarUrl: string };
type ChatMessage = { type: 'user' | 'system' | 'success'; username?: string; text: string };

const getUserId = () => {
    let id = localStorage.getItem('blindtest_userid');
    if (!id) {
        id = Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('blindtest_userid', id);
    }
    return id;
};

function App() {
  const [localSongs, setLocalSongs] = useState<any[]>([]);
  // On initialise avec une liste vide pour éviter d'afficher des choses cassées
  const [avatarList, setAvatarList] = useState<string[]>([]);

  const [username, setUsername] = useState(localStorage.getItem('blindtest_username') || "");
  const [room, setRoom] = useState(localStorage.getItem('blindtest_room') || "");
  
  // CORRECTION MAJEURE : On initialise directement avec ce qui est en mémoire
  const [selectedAvatar, setSelectedAvatar] = useState(localStorage.getItem('blindtest_avatar') || "");
  
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [userId] = useState(getUserId());
  const [isInRoom, setIsInRoom] = useState(false);
  const [volume, setVolume] = useState(50);
  const [gameState, setGameState] = useState("PREP"); 
  const [players, setPlayers] = useState<Player[]>([]);
  const [playlistSize, setPlaylistSize] = useState(0);
  const [isMyTurnToWait, setIsMyTurnToWait] = useState(false);
  const [hasFound, setHasFound] = useState(false);

  const [currentSong, setCurrentSong] = useState<any>(null);
  const [startTime, setStartTime] = useState(0);
  const [inputText, setInputText] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [revealedTitle, setRevealedTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const youtubeRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  useEffect(() => {
      if(youtubeRef.current) youtubeRef.current.setVolume(volume);
      if(audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume, currentSong]);

  // CHARGEMENT DES ASSETS (JSON)
  useEffect(() => {
    fetch('/assets.json')
        .then(res => res.json())
        .then(data => {
            if(data.songs) setLocalSongs(data.songs);
            if(data.avatars && data.avatars.length > 0) {
                setAvatarList(data.avatars);
                
                // LOGIQUE DE PRÉSERVATION :
                // Si l'utilisateur n'a JAMAIS choisi d'avatar (c'est sa première fois), on lui met le premier de la liste.
                // Sinon, on garde celui qu'il a déjà (localStorage).
                const saved = localStorage.getItem('blindtest_avatar');
                if (!saved) {
                    setSelectedAvatar(data.avatars[0]);
                    localStorage.setItem('blindtest_avatar', data.avatars[0]);
                }
            }
        })
        .catch(err => console.error("Erreur assets:", err));
  }, []);

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);

    socket.on("room_state_update", (data: any) => {
        // ON NE TOUCHE PLUS AUX AVATARS ICI.
        // On fait confiance à ce que le serveur renvoie.
        setPlayers(data.players);
        
        setGameState(data.status);
        setPlaylistSize(data.playlistSize);
        
        const me = data.players.find((p:any) => p.userId === userId);
        if (me && !isInRoom) setIsInRoom(true);

        if (data.status === 'PREP') {
            setCurrentSong(null);
            setChatMessages([]);
            setHasFound(false);
            setSearchResults([]);
            setSearchQuery("");
            setShowConfetti(false);
            setRevealedTitle("");
        }
    });

    socket.on("chat_message", (msg: ChatMessage) => { setChatMessages(prev => [...prev, msg]); });

    socket.on("play_song", (data: any) => {
      setGameState("PLAYING");
      const localInfo = data.videoId.startsWith('loc_') ? localSongs.find(s => s.videoId === data.videoId) : null;
      setCurrentSong({
          videoId: data.videoId,
          source: data.videoId.startsWith('loc_') ? 'local' : 'youtube',
          url: localInfo ? localInfo.url : null,
          title: localInfo ? localInfo.title : null,
          thumbnail: localInfo ? localInfo.thumbnail : null
      });
      setStartTime(data.startTime);
      setHasFound(false);
      setInputText("");
      setShowConfetti(false);
      setRevealedTitle("");
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
        setRevealedTitle(data.answer); 
        setChatMessages(prev => [...prev, { type: 'system', text: `Réponse : ${data.answer}` }]);
        setPlayers(prev => [...prev].sort((a:any, b:any) => b.score - a.score));
    });

    socket.on("game_finished", (finalPlayers: any) => {
        setGameState("FINISHED");
        setCurrentSong(null);
        setShowConfetti(true);
        setPlayers(finalPlayers);
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.off("room_state_update"); socket.off("play_song"); socket.off("guess_feedback");
      socket.off("round_ended"); socket.off("game_finished"); socket.off("chat_message");
    };
  }, [userId, isInRoom, localSongs]);

  const joinRoom = () => {
    if (room && username) {
      localStorage.setItem('blindtest_username', username);
      localStorage.setItem('blindtest_room', room);
      // On sauvegarde une dernière fois pour être sûr
      localStorage.setItem('blindtest_avatar', selectedAvatar);
      
      console.log("Envoi au serveur de l'avatar :", selectedAvatar); // Debug
      socket.emit("join_room", { room: room.toUpperCase(), username, userId, avatarUrl: selectedAvatar });
    }
  };

  const handleSearch = async (e: any) => {
    e.preventDefault();
    if (!searchQuery) return;
    let combinedResults = [];
    const localMatches = localSongs.filter(song => song.title.toLowerCase().includes(searchQuery.toLowerCase()));
    combinedResults.push(...localMatches);
    try {
        const response = await fetch(`${SOCKET_URL}/api/search?q=${searchQuery}`);
        const ytData = await response.json();
        const ytFormatted = ytData.map((item:any) => ({ ...item, source: 'youtube' }));
        combinedResults.push(...ytFormatted);
    } catch (error) { console.error("Erreur YouTube", error); }
    setSearchResults(combinedResults);
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
  
  // SELECTION D'AVATAR : SAUVEGARDE DIRECTE
  const onAvatarSelect = (src: string) => {
      setSelectedAvatar(src);
      localStorage.setItem('blindtest_avatar', src); // Sauvegarde immédiate
      setIsAvatarModalOpen(false);
  };

  const ytOpts = { height: '100%', width: '100%', playerVars: { autoplay: 1, start: startTime, controls: 0, disablekb: 1 } };
  const onYtReady = (event: any) => { youtubeRef.current = event.target; event.target.setVolume(volume); };
  const confettiColors = ['#FCD34D', '#3B82F6', '#FFFFFF'];

  // FONCTION D'AFFICHAGE DE L'AVATAR (CLÉ DU SUCCÈS)
  // Si le joueur a une URL (même locale "/avatars/..."), on l'affiche.
  // Sinon, on génère un DiceBear.
  const getPlayerAvatar = (player: any) => {
      if (player.avatarUrl && player.avatarUrl.trim() !== "") {
          return player.avatarUrl;
      }
      return `https://api.dicebear.com/7.x/adventurer/svg?seed=${player.username}`;
  };

  return (
    <div className="min-h-screen font-sans flex flex-col items-center relative bg-slate-900 text-gray-100 overflow-hidden">
      {showConfetti && <Confetti width={windowSize.width} height={windowSize.height} colors={confettiColors} />}

      <header className="w-full p-4 flex justify-between items-center glass-card rounded-none border-t-0 border-x-0 z-20 bg-slate-800/80">
         <h1 className="text-xl font-bold text-white tracking-tight uppercase">BestBlindTestEver</h1>
         {isInRoom && (
             <div className="flex items-center gap-6">
                 <div className="flex items-center gap-3 bg-slate-700/50 px-4 py-2 rounded-lg border border-white/5">
                     <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Volume</span>
                     <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-24 h-1 bg-slate-500 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                 </div>
                 <div className="text-sm font-medium text-gray-400 hidden md:block">SALLE <span className="text-white font-bold ml-1">{room}</span></div>
             </div>
         )}
      </header>

      {gameState === 'PLAYING' && <div className="w-full h-1 fixed top-[72px] z-20 bg-slate-800"><div className="h-full bg-blue-500 animate-timer-smooth origin-left"></div></div>}

      <main className="flex-1 w-full max-w-6xl p-4 flex flex-col relative z-10 pb-20">
        {!isInRoom ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="glass-card p-8 w-full max-w-md space-y-6 text-center">
              <h2 className="text-xl font-bold text-white uppercase tracking-widest">Initialisation</h2>
              
              <div className="mb-6 flex flex-col items-center gap-4">
                  <div className="relative group">
                      {selectedAvatar ? (
                          <img src={selectedAvatar} className="w-24 h-24 rounded-full object-cover border-4 border-blue-500 shadow-lg" />
                      ) : (
                          <div className="w-24 h-24 rounded-full bg-slate-700 border-2 border-white/10 flex items-center justify-center animate-pulse">
                              <span className="text-xs text-gray-400">Chargement...</span>
                          </div>
                      )}
                      <button onClick={() => setIsAvatarModalOpen(true)} className="absolute bottom-0 right-0 bg-white text-blue-900 rounded-full p-2 hover:scale-110 transition shadow-md">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                      </button>
                  </div>
                  <button onClick={() => setIsAvatarModalOpen(true)} className="text-xs text-blue-400 font-bold uppercase tracking-widest hover:text-blue-300 underline">Choisir mon avatar</button>
              </div>

              <div className="space-y-3">
                <input className="w-full glass-input rounded-lg px-4 py-3 text-sm" placeholder="Pseudo" value={username} onChange={(e) => setUsername(e.target.value)} />
                <input className="w-full glass-input rounded-lg px-4 py-3 uppercase font-bold text-sm" placeholder="Code Salle" value={room} onChange={(e) => setRoom(e.target.value)} />
              </div>
              <button onClick={joinRoom} disabled={!username || !room} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition disabled:opacity-50 text-sm uppercase tracking-wider">Connexion</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row gap-6 h-full min-h-[70vh] mt-4">
            <div className="flex-1 flex flex-col gap-4">
                {gameState === 'PREP' && (
                    <div className="glass-card p-6 flex-1 flex flex-col">
                        <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
                            <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Création de la Playlist</h2>
                            <span className="bg-blue-500/10 text-blue-400 px-3 py-1 rounded text-xs font-bold border border-blue-500/20">{playlistSize} Titres</span>
                        </div>
                        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                            <input placeholder="Titre ou artiste..." className="flex-1 glass-input rounded-lg px-4 py-2 text-sm" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                            <button className="bg-slate-700 hover:bg-slate-600 px-6 rounded-lg border border-white/5 text-sm font-bold">Chercher</button>
                        </form>
                        <div className="flex-1 overflow-y-auto no-scrollbar space-y-2">
                            {searchResults.map((song: any) => (
                                <div key={song.videoId} className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg cursor-pointer group transition border border-transparent hover:border-white/5" onClick={() => addSongToPlaylist(song)}>
                                    <div className="relative w-16 h-10 bg-slate-800 rounded overflow-hidden">
                                        <img src={song.thumbnail || selectedAvatar} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition" />
                                    </div>
                                    <div className="overflow-hidden flex-1">
                                        <p className="text-sm font-bold truncate text-gray-300 group-hover:text-white">{song.title}</p>
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wide">{song.source === 'local' ? 'Local File' : 'YouTube'}</p>
                                    </div>
                                    <div className="text-blue-500 text-xs font-bold opacity-0 group-hover:opacity-100 px-2">AJOUTER</div>
                                </div>
                            ))}
                        </div>
                        {playlistSize > 0 && <button onClick={startGame} className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition text-sm uppercase tracking-widest shadow-lg shadow-blue-900/20">Lancer la partie</button>}
                    </div>
                )}

                {(gameState === 'PLAYING' || gameState === 'ROUND_END') && (
                    <div className="flex-1 flex flex-col gap-4 relative">
                        <div className="glass-card flex-1 p-4 overflow-y-auto no-scrollbar flex flex-col gap-2 max-h-[60vh] bg-slate-800/40">
                             {chatMessages.map((msg, i) => (
                                 <div key={i} className={`px-3 py-2 rounded text-xs max-w-[90%] border ${msg.type === 'system' ? 'bg-transparent text-gray-400 w-full text-center border-none italic' : msg.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/20 self-center font-bold' : 'bg-slate-700 text-gray-200 border-slate-600 self-start'}`}>
                                     {msg.username && <span className="font-bold text-blue-400 mr-2 uppercase text-[10px] tracking-wide">{msg.username}</span>}
                                     {msg.text}
                                 </div>
                             ))}
                             <div ref={chatEndRef} />
                        </div>
                        {gameState === 'PLAYING' && !isMyTurnToWait && !hasFound && (
                            <form onSubmit={sendGuessOrChat} className="mt-auto"><input ref={inputRef} value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Votre réponse..." className="w-full glass-input rounded-lg px-6 py-4 text-base focus:border-blue-500 transition-all" /></form>
                        )}
                        {isMyTurnToWait && gameState === 'PLAYING' && <div className="glass-card p-4 text-center bg-indigo-500/10 text-indigo-300 border-indigo-500/20 text-sm font-bold uppercase tracking-wide">Mode Spectateur (C'est votre titre)</div>}
                        {hasFound && gameState === 'PLAYING' && <div className="glass-card p-4 text-center bg-green-500/10 text-green-400 border-green-500/20 text-sm font-bold uppercase tracking-wide animate-pulse">Bonne réponse !</div>}
                    </div>
                )}

                {gameState === 'FINISHED' && (
                    <div className="glass-card p-10 text-center flex-1 flex flex-col justify-center items-center">
                        <h1 className="text-2xl font-bold text-white mb-8 uppercase tracking-widest">Résultats Finaux</h1>
                        <button onClick={restartGame} className="bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-gray-200 transition text-sm uppercase">Rejouer</button>
                    </div>
                )}
            </div>

            <div className="w-full md:w-80 glass-card p-0 h-fit max-h-[50vh] overflow-hidden order-first md:order-last bg-slate-800/60">
               <div className="p-4 border-b border-white/5 bg-slate-800/80">
                   <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Classement</h3>
               </div>
               <ul className="overflow-y-auto no-scrollbar p-2 space-y-1">
                  {players.map((player, index) => (
                    <li key={player.id} className={`flex items-center gap-3 p-2 rounded-lg ${index === 0 ? 'bg-yellow-500/10 border border-yellow-500/20' : 'hover:bg-white/5 border border-transparent'}`}>
                       <div className="relative">
                           <img src={getPlayerAvatar(player)} className="w-8 h-8 rounded bg-slate-700 object-cover" />
                       </div>
                       <div className="flex-1 overflow-hidden">
                           <p className={`text-sm truncate ${index === 0 ? 'text-yellow-200 font-bold' : 'text-gray-300 font-medium'}`}>{player.username}</p>
                       </div>
                       <div className="font-mono font-bold text-sm text-white">{player.score}</div>
                    </li>
                  ))}
               </ul>
            </div>
          </div>
        )}
      </main>

      {isAvatarModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-slate-800 rounded-xl max-w-lg w-full p-6 border border-white/10 shadow-2xl relative">
                  <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider text-center">Choisis ton Avatar</h3>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-4 max-h-[60vh] overflow-y-auto no-scrollbar p-2">
                      {avatarList.map((src, i) => (
                          <img key={i} src={src} onClick={() => onAvatarSelect(src)} className={`w-full aspect-square rounded-lg object-cover cursor-pointer hover:scale-105 transition border-2 ${selectedAvatar === src ? 'border-blue-500' : 'border-transparent hover:border-white/20'}`} />
                      ))}
                  </div>
                  <button onClick={() => setIsAvatarModalOpen(false)} className="mt-6 w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-lg transition text-sm uppercase tracking-wide">Fermer</button>
              </div>
          </div>
      )}

      <div className={`transition-all duration-500 ease-in-out z-50 ${gameState === 'ROUND_END' ? 'fixed inset-0 flex items-center justify-center bg-black/95 backdrop-blur-md' : 'fixed top-[-9999px]'}`}>
          <div className={`relative w-full max-w-4xl flex flex-col items-center transition-all duration-700 ${gameState === 'ROUND_END' ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}>
              <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl border border-white/10">
                  {currentSong?.source === 'youtube' && <YouTube videoId={currentSong.videoId} opts={ytOpts} onReady={onYtReady} className="w-full h-full" />}
                  {currentSong?.source === 'local' && (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 relative">
                          <img src={currentSong.thumbnail} className="absolute inset-0 w-full h-full object-cover opacity-30 blur-md" />
                          <img src={currentSong.thumbnail} className="relative w-64 h-64 rounded shadow-2xl z-10 object-cover border border-white/10" />
                          <audio ref={audioRef} src={currentSong.url} autoPlay />
                      </div>
                  )}
              </div>
              <div className="mt-8 text-center px-4">
                  <h2 className="text-3xl md:text-4xl font-bold text-white mb-2 drop-shadow-xl">{revealedTitle || "Chargement..."}</h2>
                  <p className="text-blue-400 text-lg uppercase tracking-widest font-bold">C'était la réponse</p>
              </div>
          </div>
      </div>
    </div>
  );
}

export default App;