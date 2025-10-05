// Web Server สำหรับแสดง TikTok Live Comments
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import axios from 'axios';
import playSound from 'play-sound';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// สร้าง Express app และ Socket.IO
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// สร้าง audio player instance
const audioPlayer = playSound({});

// ========== การตั้งค่า ==========
const PORT = 3000;
let tiktokUsername = "tonkungtv";
let tiktokConnection = null;

// ตั้งค่าเสียง
const voiceSettings = {
  enabled: true,
}

// สร้างโฟลเดอร์สำหรับเก็บไฟล์เสียง
const audioDir = './audio';
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir);
}

// Queue สำหรับจัดการคอมเมนต์ที่รอเล่น
let commentQueue = [];
let isPlaying = false;

// Serve static files
app.use(express.static('public'));

// API endpoint สำหรับเปลี่ยน username
app.get('/connect/:username', async (req, res) => {
  try {
    const newUsername = req.params.username;
    
    // ตัดการเชื่อมต่อเดิม
    if (tiktokConnection) {
      tiktokConnection.disconnect();
    }
    
    tiktokUsername = newUsername;
    await connectToTikTok();
    
    res.json({ success: true, username: tiktokUsername });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ฟังก์ชันประมวลผล queue
async function processQueue() {
  if (isPlaying || commentQueue.length === 0) {
    return;
  }
  
  isPlaying = true;
  const commentData = commentQueue.shift();
  
  // แจ้ง client ว่ากำลังอ่านคอมเมนต์นี้
  io.emit('reading-comment', { id: commentData.id });
  
  try {
    console.log(`🔊 Reading comment (${commentQueue.length} in queue): ${commentData.comment}`);
    const audioPath = await googleTTS(commentData.comment, `${Date.now()}.mp3`);
    
    if (audioPath) {
      await playAudio(audioPath);
      // ลบไฟล์เสียงหลังเล่นเสร็จ
      setTimeout(() => {
        try {
          fs.unlinkSync(audioPath);
        } catch (err) {
          // ไม่ต้องแสดง error
        }
      }, 2000);
    }
  } catch (error) {
    console.error('❌ Queue processing error:', error.message);
  }
  
  // แจ้ง client ว่าอ่านเสร็จแล้ว
  io.emit('finished-reading', { id: commentData.id });
  
  isPlaying = false;
  
  // อัพเดทจำนวน queue
  io.emit('queue-update', { count: commentQueue.length });
  
  // เล่นคอมเมนต์ถัดไปใน queue (หน่วงเวลา 500ms)
  if (commentQueue.length > 0) {
    setTimeout(() => processQueue(), 500);
  }
}

// ฟังก์ชัน Google Translate TTS
async function googleTTS(text, filename) {
  try {
    const audioPath = path.join(audioDir, filename);
    const encodedText = encodeURIComponent(text);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=th&client=tw-ob`;
    
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    fs.writeFileSync(audioPath, response.data);
    
    if (fs.existsSync(audioPath)) {
      console.log('🎵 Google TTS completed');
      return audioPath;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Google TTS Error:', error.message);
    return null;
  }
}

// ฟังก์ชันเล่นไฟล์เสียง (บังคับให้รอจนเล่นจบจริง)
async function playAudio(audioPath) {
  const absolutePath = path.resolve(audioPath);

  try {
    await playWithWindowsMediaPlayer(absolutePath);
    console.log('🔊 Audio played via MediaPlayer');
    return;
  } catch (mediaErr) {
    console.log('⚠️ MediaPlayer fallback:', mediaErr.message);
  }

  await playWithPlaySound(absolutePath);
}

function playWithWindowsMediaPlayer(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const fileUri = pathToFileURL(filePath).href.replace(/'/g, "''");
      const psScript = `
Add-Type -AssemblyName presentationcore
$player = New-Object System.Windows.Media.MediaPlayer
$sync = New-Object System.Threading.ManualResetEvent($false)
$player.add_MediaEnded({ $sync.Set() | Out-Null })
$player.add_MediaFailed({ $sync.Set() | Out-Null })
$player.Open([Uri]::new('${fileUri}'))
$player.Volume = 1
$player.Play()
while (-not $player.NaturalDuration.HasTimeSpan) { Start-Sleep -Milliseconds 100 }
while ($player.Position -lt $player.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 200 }
$player.Stop()
$sync.Set() | Out-Null
$sync.WaitOne() | Out-Null
$player.Close()
`; // end psScript

      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      execSync(`powershell -NoProfile -WindowStyle Hidden -STA -EncodedCommand ${encoded}`, {
        stdio: 'pipe'
      });
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function playWithPlaySound(filePath) {
  return new Promise((resolve) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        console.log('⚠️ play-sound timeout, forcing resolve');
        resolve();
      }
    }, 30000);

    audioPlayer.play(filePath, (err) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (err) {
          console.log('⚠️ play-sound error:', err.message);
        } else {
          console.log('🔊 Audio played via play-sound');
        }
        resolve();
      }
    });
  });
}

// เชื่อมต่อ TikTok Live
async function connectToTikTok() {
  try {
    tiktokConnection = new TikTokLiveConnection(tiktokUsername);
    
    await tiktokConnection.connect();
    console.log(`✅ Connected to TikTok LIVE: ${tiktokUsername}`);
    
    io.emit('connection-status', { 
      connected: true, 
      username: tiktokUsername 
    });

    // Event: มีข้อความคอมเมนต์ใหม่เข้ามา
    tiktokConnection.on(WebcastEvent.CHAT, async (data) => {
      const uniqueId = data.uniqueId || data.user?.uniqueId || data.user?.displayId || 'unknown';
      const nickname = data.nickname || data.user?.nickname || uniqueId;

      // ลองหารูปโปรไฟล์จาก data structure ที่หลากหลาย
      let profilePic = data.profilePictureUrl
        || data.user?.profilePictureUrl
        || data.user?.avatarLarger
        || data.user?.avatarThumb
        || data.user?.avatarMedium;

      // ถ้าไม่มีรูป ใช้ UI Avatars
      if (!profilePic) {
        profilePic = `https://ui-avatars.com/api/?name=${encodeURIComponent(nickname)}&background=random&size=128&bold=true`;
      }
      
      const commentData = {
        id: Date.now() + Math.random(), // เพิ่ม random เผื่อเวลาซ้ำ
        user: uniqueId,
        comment: data.comment || "",
        profilePictureUrl: profilePic,
        timestamp: new Date().toLocaleTimeString('th-TH'),
        nickname
      };
      
      console.log(`💬 ${commentData.nickname} (@${commentData.user}): ${commentData.comment}`);
      
      // Debug: ดูโครงสร้างข้อมูลจาก TikTok (แสดงครั้งแรกเท่านั้น)
      if (!global.debugShown) {
        console.log('🔍 TikTok Data Structure:', JSON.stringify({
          uniqueId: data.uniqueId,
          nickname: data.nickname,
          profilePictureUrl: data.profilePictureUrl,
          user: data.user ? {
            profilePictureUrl: data.user.profilePictureUrl,
            avatarThumb: data.user.avatarThumb,
            avatarMedium: data.user.avatarMedium
          } : null
        }, null, 2));
        global.debugShown = true;
      }
      
      // ส่งคอมเมนต์ไปแสดงที่หน้าเว็บ
      io.emit('new-comment', commentData);
      
      // เพิ่มเข้า queue สำหรับอ่านเสียง
      if (voiceSettings.enabled && commentData.comment.trim()) {
        commentQueue.push(commentData);
        console.log(`➕ Added to queue (${commentQueue.length} comments waiting)`);
        
        // อัพเดทจำนวน queue
        io.emit('queue-update', { count: commentQueue.length });
        
        // เริ่มประมวลผล queue
        processQueue();
      }
    });

    // Event: มีคนเข้าชมหรือออก
    tiktokConnection.on(WebcastEvent.ROOM_USER, (data) => {
      console.log(`👀 Viewers now: ${data.viewerCount}`);
      io.emit('viewer-count', { count: data.viewerCount });
    });

    // Event: เมื่อเชื่อมต่อสำเร็จ
    tiktokConnection.on(WebcastEvent.CONNECTED, (state) => {
      console.log(`🏠 Room ID: ${state.roomId}`);
      io.emit('room-info', { roomId: state.roomId });
    });

    // Event: เมื่อหลุดการเชื่อมต่อ
    tiktokConnection.on(WebcastEvent.DISCONNECT, () => {
      console.log("❌ Disconnected");
      io.emit('connection-status', { connected: false });
    });

  } catch (err) {
    console.error("❌ Connection failed:", err);
    io.emit('connection-status', { 
      connected: false, 
      error: err.message 
    });
  }
}

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('🌐 Client connected');
  
  // ส่งสถานะปัจจุบัน
  socket.emit('connection-status', { 
    connected: tiktokConnection !== null,
    username: tiktokUsername 
  });
  
  socket.on('disconnect', () => {
    console.log('🌐 Client disconnected');
  });
  
  // รับคำสั่งเปิด/ปิดเสียง
  socket.on('toggle-voice', (data) => {
    voiceSettings.enabled = data.enabled;
    console.log(`🔊 Voice: ${voiceSettings.enabled ? 'ON' : 'OFF'}`);
    io.emit('voice-status', { enabled: voiceSettings.enabled });
  });
});

// เริ่ม server
httpServer.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📺 Open your browser and go to http://localhost:${PORT}`);
  
  // เชื่อมต่อ TikTok Live อัตโนมัติ
  await connectToTikTok();
});
