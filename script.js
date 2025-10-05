// เชื่อมต่อ Socket.IO
const socket = io();

// DOM Elements
const commentsContainer = document.getElementById('commentsContainer');
const statusIndicator = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const viewerCount = document.getElementById('viewerCount');
const usernameInput = document.getElementById('usernameInput');
const connectBtn = document.getElementById('connectBtn');
const voiceToggle = document.getElementById('voiceToggle');
const queueCount = document.getElementById('queueCount');

// State
let comments = [];

// Event Listeners
connectBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  if (username) {
    fetch(`/connect/${username}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showNotification('เชื่อมต่อสำเร็จ! 🎉', 'success');
        } else {
          showNotification('เชื่อมต่อล้มเหลว: ' + data.error, 'error');
        }
      });
  }
});

voiceToggle.addEventListener('change', (e) => {
  socket.emit('toggle-voice', { enabled: e.target.checked });
});

// Socket.IO Events
socket.on('connection-status', (data) => {
  if (data.connected) {
    statusIndicator.classList.add('connected');
    statusIndicator.classList.remove('disconnected');
    statusText.textContent = `เชื่อมต่อแล้ว: @${data.username}`;
  } else {
    statusIndicator.classList.remove('connected');
    statusIndicator.classList.add('disconnected');
    statusText.textContent = 'ไม่ได้เชื่อมต่อ';
  }
});

socket.on('viewer-count', (data) => {
  viewerCount.textContent = data.count.toLocaleString('th-TH');
});

socket.on('new-comment', (commentData) => {
  addComment(commentData);
});

socket.on('reading-comment', (data) => {
  markAsReading(data.id);
});

socket.on('finished-reading', (data) => {
  markAsFinished(data.id);
});

socket.on('queue-update', (data) => {
  queueCount.textContent = data.count;
});

socket.on('voice-status', (data) => {
  voiceToggle.checked = data.enabled;
});

// Functions
function addComment(commentData) {
  // ลบ empty state ถ้ามี
  const emptyState = commentsContainer.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }
  
  // สร้าง comment card
  const commentCard = document.createElement('div');
  commentCard.className = 'comment-card';
  commentCard.id = `comment-${commentData.id}`;
  commentCard.innerHTML = `
    <img src="${commentData.profilePictureUrl}" 
         alt="${commentData.user}" 
         class="avatar"
         onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(commentData.user)}&background=random&size=128'">
    <div class="comment-content">
      <div class="comment-header">
        <span class="username">@${commentData.user}</span>
        <span class="nickname">${commentData.nickname}</span>
        <span class="timestamp">${commentData.timestamp}</span>
      </div>
      <div class="comment-text">${escapeHtml(commentData.comment)}</div>
    </div>
  `;
  
  // เพิ่มที่ด้านบนสุด
  commentsContainer.insertBefore(commentCard, commentsContainer.firstChild);
  
  // เก็บข้อมูล comment
  comments.unshift(commentData);
  
  // จำกัดจำนวนคอมเมนต์ที่แสดง (เก็บแค่ 50 คอมเมนต์ล่าสุด)
  if (comments.length > 50) {
    const oldComment = commentsContainer.lastElementChild;
    if (oldComment && !oldComment.classList.contains('empty-state')) {
      oldComment.remove();
      comments.pop();
    }
  }
}

function markAsReading(id) {
  const commentCard = document.getElementById(`comment-${id}`);
  if (commentCard) {
    commentCard.classList.add('reading');
    
    // เพิ่ม indicator
    const header = commentCard.querySelector('.comment-header');
    const indicator = document.createElement('span');
    indicator.className = 'reading-indicator';
    indicator.innerHTML = '🔊 กำลังอ่าน...';
    header.appendChild(indicator);
    
    // Scroll ไปที่คอมเมนต์ที่กำลังอ่าน
    commentCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function markAsFinished(id) {
  const commentCard = document.getElementById(`comment-${id}`);
  if (commentCard) {
    commentCard.classList.remove('reading');
    commentCard.classList.add('finished');
    
    // ลบ indicator
    const indicator = commentCard.querySelector('.reading-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showNotification(message, type = 'info') {
  // สร้าง notification (สามารถใช้ library อย่าง toastify ได้)
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  // แสดงใน browser notification ถ้าเปิดอนุญาต
  if (Notification.permission === 'granted') {
    new Notification('TikTok Live', {
      body: message,
      icon: '/favicon.ico'
    });
  }
}

// ขออนุญาต notification
if (Notification.permission === 'default') {
  Notification.requestPermission();
}
