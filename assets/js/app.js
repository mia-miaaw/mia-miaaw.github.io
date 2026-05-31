(function(){
  // ---------- GLOBAL CONFIG ----------
  const API_BASE_URL = 'https://ai-coding-worker.androidbutut.workers.dev';

  // ---------- GLOBAL STATE ----------
  let conversations = [];        // array of { id, title, messages: [{id, text, sender, timestamp}] }
  let currentConversationId = null;
  let isWaitingResponse = false; // mencegah double-submission
  let currentTypingIndicatorElement = null;
  let attachedFiles = [];        // Menyimpan objek file terpilih secara lokal

  // DOM references
  let messagesContainer;
  let emptyPlaceholder;
  let conversationListEl;
  let chatContentEl;
  let messageInput;
  let sendBtn;
  let scrollTopFab;
  let chatTitleEl;
  let attachFileBtn;
  let hiddenFileInput;
  let attachmentPreviewContainer;

  // Custom Markdown renderer dengan bungkus Copy-Code modern
  const renderer = new marked.Renderer();
  renderer.code = function({ text, lang }) {
    const language = lang || 'code';
    const uid = 'copy-btn-' + Math.random().toString(36).substr(2, 8);
    return `
      <div class="code-block-wrapper">
        <div class="code-header">
          <span>${language.toUpperCase()}</span>
          <button class="copy-btn" data-uid="${uid}">
            <ion-icon name="copy-outline"></ion-icon>
            <span>Salin</span>
          </button>
        </div>
        <pre><code class="language-${language}">${escapeHtml(text)}</code></pre>
      </div>
    `;
  };

  marked.setOptions({ renderer });

  // Helper clipboard global untuk integrasi tombol copy code
  window.copyToClipboard = function(button, codeText) {
    const textarea = document.createElement('textarea');
    textarea.value = codeText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      const span = button.querySelector('span');
      const icon = button.querySelector('ion-icon');

      if (span) span.innerText = 'Tersalin!';
      button.style.color = '#10b981';
      if (icon) icon.setAttribute('name', 'checkmark-outline');

      setTimeout(() => {
        if (span) span.innerText = 'Salin';
        button.style.color = '';
        if (icon) icon.setAttribute('name', 'copy-outline');
      }, 2000);
    } catch (err) {
      console.error('Gagal menyalin:', err);
    } finally {
      document.body.removeChild(textarea);
    }
  };

  // Event delegation untuk menangani klik tombol salin secara dinamis
  document.addEventListener('click', function(e) {
    const button = e.target.closest('.copy-btn');
    if (button) {
      e.preventDefault();
      const wrapper = button.closest('.code-block-wrapper');
      const codeElement = wrapper ? wrapper.querySelector('pre code') : null;
      if (codeElement) {
        window.copyToClipboard(button, codeElement.innerText);
      }
    }
  });

  function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  }

  // ---------- ION ALERT KOSTUM (Promise-based) ----------
  async function confirmDialog(header, message) {
    return new Promise((resolve) => {
      const alert = document.createElement('ion-alert');
      alert.header = header;
      alert.message = message;
      alert.buttons = [
        { text: 'Batal', role: 'cancel', handler: () => resolve(false) },
        { text: 'Ya, Hapus', role: 'confirm', handler: () => resolve(true) }
      ];
      document.body.appendChild(alert);
      alert.present().then(() => {
        alert.onDidDismiss().then((event) => {
          resolve(event.role === 'confirm');
          alert.remove();
        });
      });
    });
  }

  async function showAlert(header, message) {
    const alert = document.createElement('ion-alert');
    alert.header = header;
    alert.message = message;
    alert.buttons = ['OK'];
    document.body.appendChild(alert);
    await alert.present();
    alert.onDidDismiss().then(() => alert.remove());
  }

  // ---------- STORAGE MANAGEMENT ----------
  function saveToLocalStorage() {
    localStorage.setItem('ai_chat_app_data', JSON.stringify({
      conversations,
      currentConversationId
    }));
  }

  function loadFromLocalStorage() {
    const raw = localStorage.getItem('ai_chat_app_data');
    if (!raw) {
      const defaultId = generateId();
      conversations = [{ id: defaultId, title: 'Obrolan Baru', messages: [] }];
      currentConversationId = defaultId;
      saveToLocalStorage();
      return;
    }
    try {
      const data = JSON.parse(raw);
      conversations = data.conversations || [];
      currentConversationId = data.currentConversationId || (conversations[0]?.id || null);
      if (!conversations.length) {
        const newId = generateId();
        conversations = [{ id: newId, title: 'Obrolan Baru', messages: [] }];
        currentConversationId = newId;
        saveToLocalStorage();
      }
    } catch(e) {
      console.warn(e);
      const defaultId = generateId();
      conversations = [{ id: defaultId, title: 'Obrolan Baru', messages: [] }];
      currentConversationId = defaultId;
    }
  }

  function updateConversationTitle(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    const firstUserMsg = conv.messages.find(m => m.sender === 'user');
    if (firstUserMsg && firstUserMsg.text) {
      let titleText = firstUserMsg.text;
      const fileIndex = titleText.indexOf('--- ISI BERKAS LAMPIRAN:');
      if (fileIndex !== -1) {
        titleText = titleText.substring(0, fileIndex).trim() || "Mengirim Berkas";
      } else if (titleText.startsWith('[MENGIRIM GAMBAR]')) {
        const lines = titleText.split('\n');
        titleText = lines.slice(1).join('\n').trim() || "Mengirim Gambar";
      }
      let newTitle = titleText.length > 30 ? titleText.substring(0, 27) + '...' : titleText;
      conv.title = newTitle;
    } else {
      conv.title = 'Obrolan Baru';
    }
    saveToLocalStorage();
    renderSidebar();
    if (currentConversationId === convId) {
      chatTitleEl.innerText = conv.title;
    }
  }

  // ---------- RENDER SIDEBAR ----------
  function renderSidebar() {
    if (!conversationListEl) return;
    if (conversations.length === 0) {
      conversationListEl.innerHTML = `<ion-item lines="none" class="ion-text-center"><ion-label color="medium">Tidak ada percakapan</ion-label></ion-item>`;
      return;
    }
    let html = '';
    conversations.forEach(conv => {
      const isActive = (currentConversationId === conv.id);
      const activeClass = isActive ? 'active' : '';
      html += `
        <ion-item class="conversation-item ${activeClass}" data-conv-id="${conv.id}" button detail="false">
          <ion-label class="ion-text-wrap">
            <h3 style="margin: 0; font-size: 0.95rem; font-weight: ${isActive ? '600' : '400'}">${escapeHtml(conv.title)}</h3>
            <p style="font-size: 0.75rem; color: #9ca3af; margin-top: 4px;">${conv.messages.length} pesan</p>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button class="delete-conv-btn" fill="clear" color="danger" data-conv-delete="${conv.id}">
              <ion-icon slot="icon-only" name="trash-outline" style="font-size: 1.1rem;"></ion-icon>
            </ion-button>
          </ion-buttons>
        </ion-item>
      `;
    });
    conversationListEl.innerHTML = html;

    // Pasang Event Listeners
    document.querySelectorAll('.conversation-item').forEach(item => {
      const convId = item.getAttribute('data-conv-id');
      item.addEventListener('click', (e) => {
        if (e.target.closest('.delete-conv-btn')) return;
        if (convId !== currentConversationId) {
          switchConversation(convId);
        }
      });
    });

    document.querySelectorAll('.delete-conv-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const convId = e.currentTarget.getAttribute('data-conv-delete');
        if (convId) deleteConversation(convId);
      });
    });
  }

  async function deleteConversation(convId) {
    const convToDelete = conversations.find(c => c.id === convId);
    if (!convToDelete) return;
    const confirmed = await confirmDialog('Hapus Percakapan', `Hapus "${convToDelete.title}" dari riwayat Anda?`);
    if (!confirmed) return;

    const index = conversations.findIndex(c => c.id === convId);
    if (index !== -1) conversations.splice(index, 1);

    if (conversations.length === 0) {
      const newId = generateId();
      conversations.push({ id: newId, title: 'Obrolan Baru', messages: [] });
      currentConversationId = newId;
    } else if (currentConversationId === convId) {
      currentConversationId = conversations[0].id;
    }
    saveToLocalStorage();
    renderSidebar();
    renderCurrentChat();
    const currentConv = conversations.find(c => c.id === currentConversationId);
    chatTitleEl.innerText = currentConv ? currentConv.title : 'AI Chat';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      return m;
    });
  }

  // ---------- RENDER CHAT FLAT ----------
  function renderCurrentChat() {
    if (!messagesContainer) return;
    const currentConv = conversations.find(c => c.id === currentConversationId);
    if (!currentConv) return;

    messagesContainer.innerHTML = '';
    const messages = currentConv.messages;
    if (messages.length === 0) {
      emptyPlaceholder.style.display = 'flex';
    } else {
      emptyPlaceholder.style.display = 'none';
      messages.forEach(msg => {
        appendMessageToDom(msg.sender, msg.text, false);
      });
    }

    if (isWaitingResponse) {
      showTypingIndicatorOnly();
    } else {
      removeTypingIndicator();
    }
    scrollToBottom();
  }

  function appendMessageToDom(sender, text, isStreamChunk = false) {
    let messageDiv;

    if (isStreamChunk) {
      messageDiv = document.getElementById('streaming-message-node');
    }

    if (!messageDiv) {
      messageDiv = document.createElement('div');
      messageDiv.className = `message ${sender}`;
      if (isStreamChunk) {
        messageDiv.id = 'streaming-message-node';
      }

      // 1. Avatar Bulat
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.innerText = sender === 'user' ? 'U' : 'AI';
      messageDiv.appendChild(avatar);

      // 2. Kontainer Badan Utama
      const bodyContainer = document.createElement('div');
      bodyContainer.className = 'message-body-container';

      const body = document.createElement('div');
      body.className = 'message-body';

      if (sender === 'user') {
        // Tampilkan versi ringkas di UI jika pesan berisi berkas teks yang sangat panjang
        if (text.includes('--- ISI BERKAS LAMPIRAN:')) {
          const displayDiv = document.createElement('div');
          
          const fileIndex = text.indexOf('--- ISI BERKAS LAMPIRAN:');
          const userPrompt = text.substring(0, fileIndex).trim();
          
          if (userPrompt) {
            const promptEl = document.createElement('p');
            promptEl.innerText = userPrompt;
            promptEl.style.marginBottom = '12px';
            displayDiv.appendChild(promptEl);
          }

          const regex = /--- ISI BERKAS LAMPIRAN:\s*([^\s-]+)/g;
          let match;
          const detectedFileNames = [];
          while ((match = regex.exec(text)) !== null) {
            detectedFileNames.push(match[1]);
          }

          const attachmentMarker = document.createElement('div');
          attachmentMarker.className = 'ui-file-badge';
          attachmentMarker.style.display = 'flex';
          attachmentMarker.style.flexDirection = 'column';
          attachmentMarker.style.gap = '4px';
          attachmentMarker.style.padding = '8px 12px';
          attachmentMarker.style.background = 'rgba(255, 255, 255, 0.1)';
          attachmentMarker.style.borderRadius = '8px';
          attachmentMarker.style.fontSize = '0.85rem';
          
          let fileListText = detectedFileNames.length > 0 ? detectedFileNames.join(', ') : 'Berkas';

          attachmentMarker.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
              <ion-icon name="document-text-outline" style="font-size: 1.2rem; color: #38bdf8;"></ion-icon>
              <span><strong>Membaca ${detectedFileNames.length} berkas:</strong> ${escapeHtml(fileListText)}</span>
            </div>
          `;
          
          displayDiv.appendChild(attachmentMarker);
          body.appendChild(displayDiv);
        } else if (text.startsWith('[MENGIRIM GAMBAR]')) {
          // Kasus visual jika user mengunggah berkas gambar
          const displayDiv = document.createElement('div');
          const lines = text.split('\n');
          const promptLine = lines.slice(1).join('\n').trim();

          if (promptLine) {
            const promptEl = document.createElement('p');
            promptEl.innerText = promptLine;
            promptEl.style.marginBottom = '12px';
            displayDiv.appendChild(promptEl);
          }

          const imageMarker = document.createElement('div');
          imageMarker.style.display = 'flex';
          imageMarker.style.alignItems = 'center';
          imageMarker.style.gap = '8px';
          imageMarker.style.padding = '8px 12px';
          imageMarker.style.background = 'rgba(255, 255, 255, 0.1)';
          imageMarker.style.borderRadius = '8px';
          imageMarker.style.fontSize = '0.85rem';
          imageMarker.innerHTML = `
            <ion-icon name="image-outline" style="font-size: 1.2rem; color: #10b981;"></ion-icon>
            <span><strong>Mengunggah Gambar untuk dianalisis oleh AI</strong></span>
          `;
          displayDiv.appendChild(imageMarker);
          body.appendChild(displayDiv);
        } else {
          body.innerText = text; 
        }
      } else {
        // Render Markdown & Sanitasi Aman untuk AI
        body.classList.add('markdown-content');
        const rawHtml = marked.parse(text);
        body.innerHTML = DOMPurify.sanitize(rawHtml);
      }

      bodyContainer.appendChild(body);
      messageDiv.appendChild(bodyContainer);

      const indicator = document.getElementById('live-typing-indicator');
      if (indicator) {
        messagesContainer.insertBefore(messageDiv, indicator);
      } else {
        messagesContainer.appendChild(messageDiv);
      }
    } else {
      const body = messageDiv.querySelector('.message-body');
      if (body) {
        const rawHtml = marked.parse(text);
        body.innerHTML = DOMPurify.sanitize(rawHtml);
      }
    }
  }

  function showTypingIndicatorOnly() {
    removeTypingIndicator();
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'live-typing-indicator';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'typing-dot';
      typingDiv.appendChild(dot);
    }
    messagesContainer.appendChild(typingDiv);
    scrollToBottom();
    currentTypingIndicatorElement = typingDiv;
  }

  function removeTypingIndicator() {
    if (currentTypingIndicatorElement && currentTypingIndicatorElement.parentNode) {
      currentTypingIndicatorElement.remove();
      currentTypingIndicatorElement = null;
    }
    const existing = document.getElementById('live-typing-indicator');
    if (existing) existing.remove();
  }

  function addMessageToState(sender, text) {
    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return false;

    conv.messages.push({
      id: generateId(),
      text: text,
      sender: sender,
      timestamp: Date.now()
    });

    if (sender === 'user' && conv.messages.filter(m => m.sender === 'user').length === 1) {
      updateConversationTitle(currentConversationId);
    }
    saveToLocalStorage();
    return true;
  }

  // ---------- INTEGRASI STREAMING SSE REAL-TIME ----------
  async function executeAIStream(userMessage, imageBase64 = null) {
    if (isWaitingResponse) return;
    isWaitingResponse = true;

    emptyPlaceholder.style.display = 'none';
    showTypingIndicatorOnly();

    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;

    const formattedMessages = conv.messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    let responseTextAccumulator = '';

    try {
      const response = await fetch(`${API_BASE_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin || 'http://localhost:3000'
        },
        body: JSON.stringify({
          sessionId: currentConversationId,
          messages: formattedMessages,
          image: imageBase64 // Kirim data base64 gambar jika ada
        })
      });

      removeTypingIndicator();

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            responseTextAccumulator += parseSSELine(buffer);
            appendMessageToDom('ai', responseTextAccumulator, true);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const textContent = parseSSELine(line);
          if (textContent) {
            responseTextAccumulator += textContent;
            appendMessageToDom('ai', responseTextAccumulator, true);
            scrollToBottom();
          }
        }
      }

      const streamingNode = document.getElementById('streaming-message-node');
      if (streamingNode) {
        streamingNode.removeAttribute('id');
      }

      if (responseTextAccumulator.trim()) {
        addMessageToState('ai', responseTextAccumulator.trim());
      }

    } catch (error) {
      console.error(error);
      removeTypingIndicator();

      const streamingNode = document.getElementById('streaming-message-node');
      if (streamingNode) streamingNode.remove();

      await showAlert('Gagal Terhubung', error.message || 'Terjadi gangguan saat memproses balasan AI.');
    } finally {
      isWaitingResponse = false;
      messageInput.value = '';
      messageInput.style.height = '40px'; 
      renderCurrentChat();
    }
  }

  // Helper parser sse line
  function parseSSELine(line) {
    if (!line.startsWith('data: ')) return '';
    const data = line.slice(6).trim();
    if (data === '[DONE]') return '';
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || parsed.response || '';
    } catch {
      return '';
    }
  }

  // ---------- LOGIKA PEMBACAAN FILE SECARA ASINKRONUS ----------
  async function readAndFormatFiles() {
    if (attachedFiles.length === 0) return { textPayload: "", imagePayload: null };
    
    let textPayload = "";
    let imagePayload = null;

    const readPromises = attachedFiles.map(file => {
      return new Promise((resolve) => {
        // Deteksi jika file merupakan gambar
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = function(e) {
            imagePayload = e.target.result; // Menghasilkan Base64 Data URL gambar
            resolve({ type: 'image', name: file.name });
          };
          reader.onerror = () => resolve({ type: 'error' });
          reader.readAsDataURL(file);
        } else {
          // File teks biasa
          if (file.size === 0) {
            resolve({ type: 'text', content: `\n\n--- ISI BERKAS LAMPIRAN: ${file.name} ---\n(Berkas kosong tanpa konten)\n--- AKHIR BERKAS ---` });
            return;
          }
          const reader = new FileReader();
          reader.onload = function(e) {
            resolve({ type: 'text', content: `\n\n--- ISI BERKAS LAMPIRAN: ${file.name} ---\n\`\`\`\n${e.target.result || ""}\n\`\`\`\n--- AKHIR BERKAS ---` });
          };
          reader.onerror = () => resolve({ type: 'text', content: `\n\n--- ISI BERKAS LAMPIRAN: ${file.name} ---\n[Gagal membaca isi berkas ini]\n--- AKHIR BERKAS ---` });
          reader.readAsText(file);
        }
      });
    });

    const results = await Promise.all(readPromises);
    results.forEach(res => {
      if (res.type === 'text') {
        textPayload += res.content;
      }
    });

    return { textPayload, imagePayload };
  }

  // ---------- PENGIRIMAN PESAN ----------
  async function sendUserMessage() {
    if (isWaitingResponse) {
      await showAlert('Tunggu', 'Harap tunggu respons AI saat ini selesai terlebih dahulu.');
      return;
    }
    
    let rawText = messageInput.value?.trim();
    let fileContentsText = "";
    let imageBase64Data = null;

    // Membaca isi berkas-berkas menggunakan penanganan tipe file baru
    if (attachedFiles.length > 0) {
      try {
        const processed = await readAndFormatFiles();
        fileContentsText = processed.textPayload;
        imageBase64Data = processed.imagePayload;
      } catch (fileError) {
        console.error("Gagal memproses berkas lampiran:", fileError);
        await showAlert('Gagal', 'Terjadi kesalahan saat membaca isi berkas lampiran.');
        return;
      }
    }

    // Gabungkan teks input manual dengan berkas teks
    if (fileContentsText) {
      rawText = rawText ? `${rawText}${fileContentsText}` : `Berikut adalah isi dari berkas lampiran saya:${fileContentsText}`;
    } else if (imageBase64Data) {
      // Menandai bahwa ada pengiriman gambar di dalam log chat state lokal
      rawText = rawText ? `[MENGIRIM GAMBAR]\n${rawText}` : `[MENGIRIM GAMBAR]\nTolong jelaskan gambar yang saya lampirkan ini.`;
    }

    if (!rawText && !imageBase64Data && attachedFiles.length === 0) {
      await showAlert('Pesan kosong', 'Tolong ketikkan isi pesan Anda.');
      return;
    }

    // Reset antrean berkas terlampir setelah diekstrak sepenuhnya
    attachedFiles = [];
    renderFilePreviews();

    // Simpan pesan lengkap ke dalam State percakapan
    addMessageToState('user', rawText);
    messageInput.value = '';
    messageInput.style.height = '40px'; 
    renderCurrentChat();

    // Jalankan Stream AI dengan parameter opsional gambar Base64
    await executeAIStream(rawText, imageBase64Data);
  }

  function createNewChat() {
    if (isWaitingResponse) {
      showAlert('Tunggu', 'Selesaikan proses streaming sebelum membuat percakapan baru.');
      return;
    }
    const newId = generateId();
    const newConv = { id: newId, title: 'Obrolan Baru', messages: [] };
    conversations.unshift(newConv);
    currentConversationId = newId;
    saveToLocalStorage();
    renderSidebar();
    renderCurrentChat();
    chatTitleEl.innerText = 'Obrolan Baru';
    scrollToBottom();
  }

  function switchConversation(convId) {
    if (isWaitingResponse) {
      showAlert('Tunggu', 'Selesaikan proses streaming sebelum berpindah riwayat.');
      return;
    }
    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;
    currentConversationId = convId;
    saveToLocalStorage();
    renderSidebar();
    renderCurrentChat();
    chatTitleEl.innerText = conv.title;
    messageInput.value = '';
    messageInput.style.height = '40px'; 
  }

  async function clearCurrentChat() {
    if (isWaitingResponse) {
      showAlert('Tunggu', 'AI sedang merespon, mohon tunggu beberapa saat.');
      return;
    }
    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;
    if (conv.messages.length === 0) {
      showAlert('Info', 'Sesi percakapan ini memang sudah bersih.');
      return;
    }
    const confirmed = await confirmDialog('Bersihkan Pesan', `Hapus seluruh isi riwayat pesan pada sesi "${conv.title}"?`);
    if (confirmed) {
      conv.messages = [];
      saveToLocalStorage();
      renderCurrentChat();
      updateConversationTitle(currentConversationId);
      chatTitleEl.innerText = conv.title;
    }
  }

  // SCROLL HELPERS
  async function scrollToBottom() {
    await new Promise(r => setTimeout(r, 40));
    const contentEl = document.querySelector('#chat-content');
    if (contentEl && contentEl.getScrollElement) {
      const scrollEl = await contentEl.getScrollElement();
      if (scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      }
    }
  }

  async function scrollToTop() {
    const contentEl = document.querySelector('#chat-content');
    if (contentEl && contentEl.getScrollElement) {
      const scrollEl = await contentEl.getScrollElement();
      if (scrollEl) {
        scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }

  // ---------- LOGIKA DETEKSI POSISI GULIRAN UNTUK TOMBOL SCROLL TO BOTTOM ----------
  async function initScrollListener() {
    const chatContent = document.querySelector('#chat-content');
    if (!chatContent) return;

    // Ambil elemen DOM guliran asli di dalam shadow-root Ionic
    const scrollEl = await chatContent.getScrollElement();
    if (!scrollEl) return;

    chatContent.addEventListener('ionScroll', (ev) => {
      const scrollTop = ev.detail.scrollTop;
      const scrollHeight = scrollEl.scrollHeight;
      const clientHeight = scrollEl.clientHeight;
      
      // Jarak sisa guliran menuju posisi paling bawah (px)
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      // LOGIKA KOREKSI (SCROLL TO BOTTOM FAB):
      // - Munculkan tombol jika posisi pengguna melayang di atas (jarak ke dasar chat > 250px)
      // - Otomatis tersembunyi jika pengguna sudah sangat dekat atau sampai di pesan terbaru (jarak ke dasar <= 250px)
      if (distanceFromBottom > 250) {
        scrollTopFab.style.display = 'flex';
      } else {
        scrollTopFab.style.display = 'none';
      }
    });
  }

  // ---------- LOGIKA INPUT MULTI-ROW & LAMPIRAN BERKAS ----------
  function setupModernInputEvents() {
    messageInput.addEventListener('focus', () => {
      messageInput.style.height = '100px';
    });

    messageInput.addEventListener('blur', () => {
      if (!messageInput.value.trim()) {
        messageInput.style.height = '40px';
      }
    });

    messageInput.addEventListener('input', () => {
      if (messageInput.value.trim() === '') {
        messageInput.style.height = '40px';
      } else {
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      }
    });

    attachFileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener('change', function(e) {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        files.forEach(file => {
          const isExist = attachedFiles.some(f => f.name === file.name && f.size === file.size);
          if (!isExist) {
            attachedFiles.push(file);
          }
        });
        renderFilePreviews();
        this.value = '';
        messageInput.focus();
      }
    });
  }

  // Merender cip visual untuk berkas yang siap dikirim
  function renderFilePreviews() {
    if (!attachmentPreviewContainer) return;
    attachmentPreviewContainer.innerHTML = '';
    
    if (attachedFiles.length === 0) {
      attachmentPreviewContainer.style.display = 'none';
      return;
    }

    attachmentPreviewContainer.style.display = 'flex';
    
    attachedFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      
      const isImg = file.type.startsWith('image/');
      const iconName = isImg ? 'image-outline' : 'document-attach-outline';
      const colorStyle = isImg ? 'color: #10b981;' : '';

      chip.innerHTML = `
        <ion-icon name="${iconName}" style="${colorStyle}"></ion-icon>
        <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.name)}</span>
        <button type="button" class="remove-file-btn" data-index="${index}">
          <ion-icon name="close-circle"></ion-icon>
        </button>
      `;

      chip.querySelector('.remove-file-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        attachedFiles.splice(index, 1);
        renderFilePreviews();
      });

      attachmentPreviewContainer.appendChild(chip);
    });
  }

  // ---------- INITIALIZE APP ----------
  function init() {
    loadFromLocalStorage();
    messagesContainer = document.getElementById('messages-container');
    emptyPlaceholder = document.getElementById('empty-chat-placeholder');
    conversationListEl = document.getElementById('conversation-list');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-message-btn');
    scrollTopFab = document.getElementById('scroll-top-fab');
    chatTitleEl = document.getElementById('chat-title');
    
    attachFileBtn = document.getElementById('attach-file-btn');
    hiddenFileInput = document.getElementById('hidden-file-input');
    attachmentPreviewContainer = document.getElementById('attachment-preview-container');

    renderSidebar();
    renderCurrentChat();
    const curConv = conversations.find(c => c.id === currentConversationId);
    if (curConv) chatTitleEl.innerText = curConv.title;

    sendBtn.addEventListener('click', () => sendUserMessage());
    
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      }
    });

    document.getElementById('new-chat-btn')?.addEventListener('click', () => createNewChat());
    document.getElementById('clear-current-chat-btn')?.addEventListener('click', () => clearCurrentChat());
    
    // KOREKSI TOMBOL KLIK: Sekarang tombol ini otomatis mengarahkan ke bawah (scrollToBottom)
    const scrollBtn = document.getElementById('scroll-top-btn');
    if (scrollBtn) {
      scrollBtn.addEventListener('click', () => scrollToBottom());
      
      // Mengubah ikonnya secara dinamis menjadi arah bawah agar selaras dengan fungsinya
      const icon = scrollBtn.querySelector('ion-icon');
      if (icon) {
        icon.setAttribute('name', 'arrow-down-outline');
      }
    }

    setupModernInputEvents();
    initScrollListener();

    setTimeout(() => {
      scrollToBottom();
    }, 300);
  }

  window.addEventListener('DOMContentLoaded', () => {
    init();
  });
})();