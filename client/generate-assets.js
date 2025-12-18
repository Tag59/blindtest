import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Nécessaire pour avoir __dirname avec les modules ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_FILE = path.join(PUBLIC_DIR, 'assets.json');

console.log("🤖 Scan des dossiers en cours...");

// 1. SCAN DES AVATARS
const avatarsDir = path.join(PUBLIC_DIR, 'avatars');
let avatarList = [];

if (fs.existsSync(avatarsDir)) {
    const files = fs.readdirSync(avatarsDir);
    // On garde seulement les images
    avatarList = files
        .filter(file => /\.(png|jpg|jpeg|gif|svg)$/i.test(file))
        .map(file => `/avatars/${file}`);
    console.log(` ${avatarList.length} avatars trouvés.`);
} else {
    console.warn(" Dossier 'public/avatars' introuvable.");
}

// 2. SCAN DES SONS
const songsDir = path.join(PUBLIC_DIR, 'songs');
let songList = [];

if (fs.existsSync(songsDir)) {
    const files = fs.readdirSync(songsDir);
    // On garde seulement les mp3
    const mp3Files = files.filter(file => /\.mp3$/i.test(file));
    
    songList = mp3Files.map((file, index) => {
        // On nettoie le nom du fichier pour faire un Titre joli
        // Ex: "Daft_Punk_-_Get_Lucky.mp3" devient "Daft Punk - Get Lucky"
        const cleanTitle = file
            .replace(/\.mp3$/i, '')       // Enlever l'extension
            .replace(/_/g, ' ')           // Remplacer les tirets bas par des espaces
            .replace(/-/g, ' - ');        // Espacer les tirets

        // On cherche si une image porte le même nom (ex: track.mp3 -> track.jpg)
        const possibleCover = files.find(f => f.startsWith(file.replace('.mp3', '')) && /\.(jpg|png)$/i.test(f));

        return {
            videoId: `loc_${index}_${Date.now()}`, // ID unique
            title: cleanTitle, // Le titre déduit du nom de fichier
            thumbnail: possibleCover ? `/songs/${possibleCover}` : "/avatars/avatar1.png", // Cover ou image par défaut
            source: "local",
            url: `/songs/${file}`,
            channel: "Local Library"
        };
    });
    console.log(` ${songList.length} sons trouvés.`);
} else {
    console.warn(" Dossier 'public/songs' introuvable.");
}

// 3. ÉCRITURE DU FICHIER JSON
const finalData = {
    avatars: avatarList,
    songs: songList
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalData, null, 2));
console.log(` Fichier généré avec succès : ${OUTPUT_FILE}`);