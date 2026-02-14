
const state = {
    token: localStorage.getItem('chatToken'),
    user: null,
    ws: null,
    publicRoomId: null,
    privateRoomId: null,
    typingTimers: {
        public: null,
        private: null
    },
    pendingFile: null,
    previewUrl: null,
    activeUser: null,
    unreadByUser: {},
    captcha: {
        id: null,
        code: null
    },
    publicPending: null,
    videoCall: {
        peerConnection: null,
        localStream: null,
        isInitiator: false
    },
    pendingVideoCallOffer: null
};

const PC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let toastTimeout = null;
const TOAST_DURATION_MS = 4000;

const showToast = (message) => {
    const el = document.getElementById('chatToast');
    if (!el) return;
    if (toastTimeout) clearTimeout(toastTimeout);
    el.textContent = message;
    el.classList.remove('hidden');
    toastTimeout = setTimeout(() => {
        el.classList.add('hidden');
        toastTimeout = null;
    }, TOAST_DURATION_MS);
};

const apiRequest = async (endpoint, options = {}) => {
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
        },
        ...options
    };

    const response = await fetch(endpoint, config);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }
    return data;
};

const sendWs = (payload) => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        return false;
    }
    state.ws.send(JSON.stringify(payload));
    return true;
};

const initialsFromName = (name) => {
    if (!name) return 'G';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
};


const renderAttachment = (attachment, options = {}) => {
    if (!attachment) {
        return '';
    }
    const isPrivateFile = options.isPrivate && attachment.url && attachment.url.startsWith('/api/private-file/');
    if (isPrivateFile) {
        const name = (attachment.name || 'file').replace(/"/g, '&quot;');
        const type = (attachment.type || '').replace(/"/g, '&quot;');
        const url = attachment.url.replace(/"/g, '&quot;');
        return `<div class="chat2-attachment chat2-attachment-private" data-url="${url}" data-name="${name}" data-type="${type}"><span class="chat2-attachment-loading">Loading...</span></div>`;
    }
    if (attachment.type && attachment.type.startsWith('image/')) {
        return `<div class="chat2-attachment"><img src="${attachment.url}" alt="${attachment.name || 'image'}" /></div>`;
    }
    const label = attachment.name || attachment.url;
    return `<div class="chat2-attachment"><a href="${attachment.url}" target="_blank">${label}</a></div>`;
};

let imageLightboxEl = null;

const openImageLightbox = (imageUrl) => {
    if (!imageLightboxEl) {
        imageLightboxEl = document.createElement('div');
        imageLightboxEl.className = 'chat2-image-lightbox hidden';
        imageLightboxEl.innerHTML = '<div class="chat2-image-lightbox-backdrop"><img alt="Perbesar" /></div>';
        imageLightboxEl.querySelector('.chat2-image-lightbox-backdrop').addEventListener('click', () => {
            imageLightboxEl.classList.add('hidden');
        });
        document.body.appendChild(imageLightboxEl);
    }
    const img = imageLightboxEl.querySelector('img');
    img.src = imageUrl;
    imageLightboxEl.classList.remove('hidden');
};

const loadPrivateAttachments = (container) => {
    if (!container || !state.token) return;
    const placeholders = container.querySelectorAll('.chat2-attachment-private:not([data-loaded])');
    placeholders.forEach((el) => {
        const url = el.getAttribute('data-url');
        const name = el.getAttribute('data-name') || 'file';
        const type = el.getAttribute('data-type') || '';
        if (!url) return;
        el.setAttribute('data-loaded', '1');
        fetch(url, {
            headers: { Authorization: `Bearer ${state.token}` }
        })
            .then((res) => {
                if (!res.ok) throw new Error('Failed to load');
                return res.blob();
            })
            .then((blob) => {
                const objectUrl = URL.createObjectURL(blob);
                const isImage = type.startsWith('image/');
                if (isImage) {
                    const safeName = name.replace(/</g, '&lt;').replace(/"/g, '&quot;');
                    const expandSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
                    const downloadSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
                    el.innerHTML = `
                        <div class="chat2-attachment-image-wrap">
                            <img src="${objectUrl}" alt="${safeName}" />
                            <div class="chat2-attachment-overlay">
                                <button type="button" class="chat2-attachment-btn chat2-attachment-btn-enlarge" title="Perbesar">${expandSvg}</button>
                                <button type="button" class="chat2-attachment-btn chat2-attachment-btn-download" title="Download" data-name="${safeName}">${downloadSvg}</button>
                            </div>
                        </div>`;
                    const wrap = el.querySelector('.chat2-attachment-image-wrap');
                    wrap.querySelector('.chat2-attachment-btn-enlarge').addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openImageLightbox(objectUrl);
                    });
                    wrap.querySelector('.chat2-attachment-btn-download').addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const a = document.createElement('a');
                        a.href = objectUrl;
                        a.download = name || 'image';
                        a.click();
                    });
                } else {
                    el.innerHTML = `<a href="${objectUrl}" download="${name}" target="_blank">${name}</a>`;
                }
                el.classList.remove('chat2-attachment-private');
            })
            .catch(() => {
                el.innerHTML = '<span class="chat2-attachment-error">Unable to load file</span>';
                el.classList.remove('chat2-attachment-private');
            });
    });
};


const setAttachmentPreview = ({ attachment, file }) => {
    const preview = document.getElementById('privateAttachmentPreview');
    if (state.previewUrl) {
        URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = null;
    }

    if (!attachment && !file) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
        return;
    }
    let isImage = false;
    let name = 'File';
    let url = '';

    if (attachment) {
        isImage = attachment.type && attachment.type.startsWith('image/');
        name = attachment.name || attachment.url || 'File';
        url = attachment.url;
    } else if (file) {
        isImage = file.type && file.type.startsWith('image/');
        name = file.name || 'File';
        url = URL.createObjectURL(file);
        state.previewUrl = url;
    }

    const thumb = isImage ? `<img src="${url}" alt="${name}" />` : '';
    preview.innerHTML = `
        ${thumb}
        <div class="chat2-attachment-name">${name}</div>
        <button type="button" data-action="remove">x</button>
    `;
    preview.classList.remove('hidden');
};

const setUserLabel = (name) => {
    document.getElementById('chatUserLabel').textContent = name || 'Guest';
};

const renderMessageRow = (msg, options = {}) => {
    const showStatus = options.showStatus || false;
    const isPrivate = options.showStatus || false;
    if (msg.system) {
        const time = new Date(msg.createdAt).toLocaleTimeString();
        return `<div class="chat2-message chat2-message-system">
            <div class="chat2-message-system-content">${msg.content}</div>
            <div class="chat2-message-system-time">${time}</div>
        </div>`;
    }
    const time = new Date(msg.createdAt).toLocaleTimeString();
    const initials = initialsFromName(msg.username);
    const isOwn = state.user && (msg.username === (state.user.displayName || state.user.username));
    const status = showStatus && isOwn && msg.status ? `<div class="chat2-message-status">${msg.status === 'read' ? 'Read' : 'Send'}</div>` : '';
    return `
        <div class="chat2-message ${isOwn ? 'is-own' : ''}">
            <div class="chat2-avatar">${initials}</div>
            <div class="chat2-message-content">
                <div class="chat2-message-meta">
                    <span>${msg.username}</span>
                    <span>${time}</span>
                </div>
                <div class="chat2-message-body">${msg.content}</div>
                ${renderAttachment(msg.attachment || null, { isPrivate })}
                ${status}
            </div>
        </div>
    `;
};

const renderMessages = (container, messages, options = {}) => {
    const isPrivate = options.showStatus || false;
    container.innerHTML = messages.map((msg) => renderMessageRow(msg, options)).join('');
    container.scrollTop = container.scrollHeight;
    if (isPrivate) loadPrivateAttachments(container);
};

const appendMessages = (container, messages, options = {}) => {
    const isPrivate = options.showStatus || false;
    const html = messages.map((msg) => renderMessageRow(msg, options)).join('');
    container.insertAdjacentHTML('beforeend', html);
    container.scrollTop = container.scrollHeight;
    if (isPrivate) loadPrivateAttachments(container);
};

const showPublicNotice = (message) => {
    const code = document.getElementById('captchaCode');
    code.textContent = message;
    code.classList.add('is-error');
    setTimeout(() => {
        code.classList.remove('is-error');
        if (state.captcha.code) {
            code.textContent = state.captcha.code;
        }
    }, 1500);
};

const refreshCaptcha = async () => {
    try {
        const captcha = await apiRequest('/api/captcha');
        state.captcha = captcha;
        const code = document.getElementById('captchaCode');
        code.textContent = captcha.code;
        code.classList.remove('is-error');
        const colors = ['#0f766e', '#b45309', '#1d4ed8', '#7c2d12', '#0f172a'];
        code.style.color = colors[Math.floor(Math.random() * colors.length)];
    } catch (error) {
        showPublicNotice('Captcha error');
    }
};

const showCaptchaModal = async () => {
    document.getElementById('captchaModal').classList.remove('hidden');
    await refreshCaptcha();
};

const hideCaptchaModal = () => {
    document.getElementById('captchaModal').classList.add('hidden');
    document.getElementById('captchaInput').value = '';
};

const initPublicRoom = async () => {
    const room = await apiRequest('/api/rooms/public');
    state.publicRoomId = room.id;
    const messages = await apiRequest('/api/rooms/public/messages');
    renderMessages(document.getElementById('publicMessages'), messages);
    sendWs({ type: 'join_public' });
};

const showLoginModal = () => {
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('registerModal').classList.add('hidden');
};

const showRegisterModal = () => {
    document.getElementById('registerModal').classList.remove('hidden');
    document.getElementById('loginModal').classList.add('hidden');
};

const hideModals = () => {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('registerModal').classList.add('hidden');
};

const updatePrivateInputAreaState = () => {
    const disabled = !state.user || !state.privateRoomId;
    const area = document.getElementById('privateInputArea');
    if (area) area.classList.toggle('is-disabled', disabled);
    document.getElementById('privateMessageInput').disabled = disabled;
    document.getElementById('sendPrivate').disabled = disabled;
    document.getElementById('videoCallPrivate').disabled = disabled;
    document.getElementById('attachPrivate').disabled = disabled;
    document.getElementById('emojiPrivate').disabled = disabled;
};

const getVideoCallModal = () => ({
    modal: document.getElementById('videoCallModal'),
    status: document.getElementById('videoCallStatus'),
    localVideo: document.getElementById('videoCallLocal'),
    remoteVideo: document.getElementById('videoCallRemote'),
    remotePlaceholder: document.getElementById('videoCallRemotePlaceholder')
});

const endVideoCall = (sendSignal = true) => {
    const { modal, localVideo, remoteVideo, remotePlaceholder } = getVideoCallModal();
    if (state.videoCall.peerConnection) {
        state.videoCall.peerConnection.close();
        state.videoCall.peerConnection = null;
    }
    if (state.videoCall.localStream) {
        state.videoCall.localStream.getTracks().forEach((t) => t.stop());
        state.videoCall.localStream = null;
    }
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (remotePlaceholder) {
        remotePlaceholder.classList.remove('hidden');
        remotePlaceholder.textContent = 'Menunggu...';
    }
    if (modal) modal.classList.add('hidden');
    if (sendSignal && state.privateRoomId && state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendWs({ type: 'video_call_end', roomId: state.privateRoomId });
    }
};

const startVideoCall = async () => {
    if (!state.privateRoomId || !state.user || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const { modal, status, localVideo, remoteVideo, remotePlaceholder } = getVideoCallModal();
    if (!modal || !localVideo || !remoteVideo) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        state.videoCall.localStream = stream;
        state.videoCall.isInitiator = true;
        localVideo.srcObject = stream;

        const pc = new RTCPeerConnection(PC_CONFIG);
        state.videoCall.peerConnection = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (e) => {
            if (remoteVideo && e.streams && e.streams[0]) {
                remoteVideo.srcObject = e.streams[0];
                if (remotePlaceholder) remotePlaceholder.classList.add('hidden');
            }
        };
        pc.onicecandidate = (e) => {
            if (e.candidate && state.ws && state.ws.readyState === WebSocket.OPEN) {
                sendWs({ type: 'video_call_ice', roomId: state.privateRoomId, candidate: e.candidate });
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWs({ type: 'video_call_offer', roomId: state.privateRoomId, offer });

        if (status) status.textContent = 'Memanggil...';
        if (remotePlaceholder) remotePlaceholder.textContent = 'Menunggu jawaban...';
        modal.classList.remove('hidden');
    } catch (err) {
        showToast(err.message || 'Tidak dapat mengakses kamera/mikrofon');
    }
};

const getIncomingCallModal = () => ({
    modal: document.getElementById('incomingVideoCallModal'),
    fromEl: document.getElementById('incomingVideoCallFrom'),
    ringtone: document.getElementById('videoCallRingtone')
});

const stopIncomingRingtone = () => {
    const ringtone = getIncomingCallModal().ringtone;
    if (ringtone) {
        ringtone.pause();
        ringtone.currentTime = 0;
    }
};

const showIncomingVideoCall = (payload) => {
    if (state.videoCall.peerConnection) return;
    state.pendingVideoCallOffer = payload;
    const { modal, fromEl } = getIncomingCallModal();
    if (fromEl) fromEl.textContent = payload.fromUsername ? `Dari: ${payload.fromUsername}` : 'Panggilan video masuk';
    if (modal) modal.classList.remove('hidden');
    const ringtone = getIncomingCallModal().ringtone;
    if (ringtone) {
        ringtone.currentTime = 0;
        ringtone.play().catch(() => {});
    }
};

const hideIncomingVideoCall = () => {
    state.pendingVideoCallOffer = null;
    stopIncomingRingtone();
    const modal = getIncomingCallModal().modal;
    if (modal) modal.classList.add('hidden');
};

const acceptIncomingVideoCall = async () => {
    const payload = state.pendingVideoCallOffer;
    if (!payload) return;
    hideIncomingVideoCall();
    await handleVideoCallOffer(payload);
};

const declineIncomingVideoCall = () => {
    const rejectSound = document.getElementById('videoCallRejectSound');
    if (rejectSound) {
        rejectSound.currentTime = 0;
        rejectSound.play().catch(() => {});
    }
    if (state.privateRoomId && state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendWs({ type: 'video_call_decline', roomId: state.privateRoomId });
    }
    hideIncomingVideoCall();
};

const handleVideoCallOffer = async (payload) => {
    if (!state.privateRoomId || state.privateRoomId !== payload.roomId || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const { modal, status, localVideo, remoteVideo, remotePlaceholder } = getVideoCallModal();
    if (!modal || !localVideo || !remoteVideo) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        state.videoCall.localStream = stream;
        state.videoCall.isInitiator = false;
        localVideo.srcObject = stream;

        const pc = new RTCPeerConnection(PC_CONFIG);
        state.videoCall.peerConnection = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (e) => {
            if (remoteVideo && e.streams && e.streams[0]) {
                remoteVideo.srcObject = e.streams[0];
                if (remotePlaceholder) remotePlaceholder.classList.add('hidden');
            }
        };
        pc.onicecandidate = (e) => {
            if (e.candidate && state.ws && state.ws.readyState === WebSocket.OPEN) {
                sendWs({ type: 'video_call_ice', roomId: state.privateRoomId, candidate: e.candidate });
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendWs({ type: 'video_call_answer', roomId: state.privateRoomId, answer });

        if (status) status.textContent = `Panggilan dengan ${payload.fromUsername || 'pengguna'}`;
        if (remotePlaceholder) remotePlaceholder.textContent = 'Menghubungkan...';
        modal.classList.remove('hidden');
    } catch (err) {
        showToast(err.message || 'Tidak dapat mengakses kamera/mikrofon');
    }
};

const handleVideoCallAnswer = async (payload) => {
    if (!state.videoCall.peerConnection || payload.roomId !== state.privateRoomId) return;
    try {
        await state.videoCall.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer));
        const el = getVideoCallModal().status;
        if (el) el.textContent = 'Terhubung';
    } catch (err) {
        endVideoCall();
    }
};

const handleVideoCallIce = async (payload) => {
    if (!state.videoCall.peerConnection || payload.roomId !== state.privateRoomId) return;
    try {
        await state.videoCall.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (err) {
        // ignore
    }
};

const setAuthState = (user) => {
    state.user = user;
    setUserLabel(user ? user.displayName : 'Guest');
    document.getElementById('loginTrigger').classList.toggle('hidden', !!user);
    document.getElementById('registerTrigger').classList.toggle('hidden', !!user);
    document.getElementById('logoutTrigger').classList.toggle('hidden', !user);
    updatePrivateInputAreaState();
    document.getElementById('privateCard').classList.toggle('hidden', !user);
    document.getElementById('togglePublicCard').classList.toggle('hidden', !user);
    const grid = document.querySelector('.chat2-grid');
    if (user) {
        grid.classList.add('is-public-narrow');
        document.getElementById('togglePublicCard').classList.add('is-expanded');
    } else {
        grid.classList.remove('is-public-narrow');
        document.getElementById('togglePublicCard').classList.remove('is-expanded');
    }
    if (user) {
        hideModals();
    }
};

const handleLogin = async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    state.token = data.token;
    localStorage.setItem('chatToken', data.token);
    setAuthState(data.user);
    hideModals();
    await loadPrivateData();
    sendWs({ type: 'auth', token: data.token });
};

const handleRegister = async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    document.getElementById('loginUsername').value = username;
    document.getElementById('loginPassword').value = '';
    showLoginModal();
};

const loadPrivateData = async () => {
    if (!state.token) return;
    const users = await apiRequest('/api/users');
    state.unreadByUser = state.unreadByUser || {};
    const rooms = await apiRequest('/api/rooms/private');
    if (users.length > 0 && !state.privateRoomId) {
        state.activeUser = users[0].username;
        const roomWithFirst = rooms.find((r) => r.members && r.members.some((m) => m.username === users[0].username));
        if (roomWithFirst) {
            await openPrivateRoom(roomWithFirst.id);
        } else {
            await startPrivateRoomWithUser(users[0].username);
            return;
        }
    } else if (!state.privateRoomId && rooms.length > 0) {
        await openPrivateRoom(rooms[0].id);
        const room = rooms[0];
        const other = room.members && room.members.find((m) => m.userId !== state.user?.id && m.username);
        if (other) state.activeUser = other.username;
    }
    renderUsers(users);
    renderPrivateRooms(rooms);
};

const renderUsers = (users) => {
    const list = document.getElementById('userList');
    list.innerHTML = users.map((user) => `
        <button class="chat2-list-item ${user.username === state.activeUser ? 'active' : ''}" data-username="${user.username}">
            <span>${user.displayName || user.username}</span>
            ${state.unreadByUser && state.unreadByUser[user.username] ? `<span class="chat2-badge">${state.unreadByUser[user.username]}</span>` : ''}
        </button>
    `).join('');
};

const renderPrivateRooms = () => {};

const openPrivateRoom = async (roomId) => {
    state.privateRoomId = roomId;
    const messages = await apiRequest(`/api/rooms/${roomId}/messages`);
    renderMessages(document.getElementById('privateMessages'), messages, { showStatus: true });
    updatePrivateInputAreaState();
    sendWs({ type: 'join_private', roomId });
    renderPrivateRooms(await apiRequest('/api/rooms/private'));
    await markPrivateRead();
};

const startPrivateRoomWithUser = async (username) => {
    state.activeUser = username;
    const room = await apiRequest('/api/rooms/private', {
        method: 'POST',
        body: JSON.stringify({ username })
    });
    await openPrivateRoom(room.id);
    await loadPrivateData();
};

const sendPublicMessage = async () => {
    const input = document.getElementById('publicMessageInput');
    const guestNameInput = document.getElementById('guestName');
    const content = input.value.trim();
    const guestName = guestNameInput.value.trim();
    if (!content) return;

    state.publicPending = { content, guestName };
    await showCaptchaModal();
};

const confirmPublicMessage = async () => {
    if (!state.publicPending) {
        hideCaptchaModal();
        return;
    }
    const { content, guestName } = state.publicPending;
    const captchaInput = document.getElementById('captchaInput');
    const captchaCode = captchaInput.value.trim();
    if (!state.captcha.code || captchaCode !== state.captcha.code) {
        showPublicNotice('Captcha salah');
        await refreshCaptcha();
        return;
    }

    const sent = sendWs({
        type: 'public_message',
        content,
        guestName,
        captchaId: state.captcha.id,
        captchaCode
    });
    if (!sent) {
        await apiRequest('/api/rooms/public/messages', {
            method: 'POST',
            body: JSON.stringify({ content, guestName, captchaId: state.captcha.id, captchaCode })
        });
    }
    document.getElementById('publicMessageInput').value = '';
    document.getElementById('captchaInput').value = '';
    if (guestName) {
        localStorage.setItem('guestName', guestName);
    }
    state.publicPending = null;
    hideCaptchaModal();
};


const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const uploadPrivateFile = async (file) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error('File terlalu besar. Maksimal 10 Mb.');
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('forPrivate', '1');
    const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
            ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
        },
        body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
    }
    return data;
};

const sendPrivateMessage = async (attachment = null) => {
    const input = document.getElementById('privateMessageInput');
    const content = input.value.trim();
    if (!content && !attachment && !state.pendingFile) return;
    if (!state.privateRoomId) return;

    let activeAttachment = attachment;
    if (!activeAttachment && state.pendingFile) {
        try {
            activeAttachment = await uploadPrivateFile(state.pendingFile);
        } catch (err) {
            showToast(err.message || 'Upload gagal');
            return;
        }
    }

    const sent = sendWs({ type: 'private_message', roomId: state.privateRoomId, content, attachment: activeAttachment });
    if (!sent) {
        await apiRequest(`/api/rooms/${state.privateRoomId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content, attachment: activeAttachment })
        });
    }
    input.value = '';
    state.pendingFile = null;
    setAttachmentPreview({ attachment: null, file: null });
};

const markPrivateRead = async () => {
    if (!state.privateRoomId || !state.user) {
        return;
    }
    sendWs({ type: 'read', roomId: state.privateRoomId });
    await refreshUnread();
};

const refreshUnread = async () => {
    if (!state.token) return;
    const users = await apiRequest('/api/users');
    renderUsers(users);
};

const showTyping = (scope, username) => {
    const element = document.getElementById(scope === 'public' ? 'publicTyping' : 'privateTyping');
    element.textContent = `${username} sedang mengetik...`;
    element.classList.remove('hidden');
    if (state.typingTimers[scope]) {
        clearTimeout(state.typingTimers[scope]);
    }
    state.typingTimers[scope] = setTimeout(() => {
        element.classList.add('hidden');
    }, 2000);
};

const emitTyping = (scope) => {
    if (scope === 'public') {
        sendWs({ type: 'typing', scope: 'public', isTyping: true });
        return;
    }
    if (scope === 'private' && state.privateRoomId) {
        sendWs({ type: 'typing', scope: 'private', roomId: state.privateRoomId, isTyping: true });
    }
};

const attachEvents = () => {
    document.getElementById('captchaRefresh').addEventListener('click', refreshCaptcha);
    document.getElementById('captchaConfirm').addEventListener('click', confirmPublicMessage);
    document.getElementById('captchaCancel').addEventListener('click', () => {
        state.publicPending = null;
        hideCaptchaModal();
    });
    document.getElementById('sendPublic').addEventListener('click', sendPublicMessage);
    document.getElementById('publicMessageInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendPublicMessage();
        } else {
            emitTyping('public');
        }
    });

    document.getElementById('videoCallPrivate').addEventListener('click', () => startVideoCall());
    document.getElementById('videoCallEnd').addEventListener('click', () => endVideoCall());
    document.getElementById('incomingVideoCallAccept').addEventListener('click', () => acceptIncomingVideoCall());
    document.getElementById('incomingVideoCallDecline').addEventListener('click', () => declineIncomingVideoCall());
    document.getElementById('sendPrivate').addEventListener('click', () => sendPrivateMessage());
    document.getElementById('attachPrivate').addEventListener('click', () => {
        document.getElementById('privateFileInput').click();
    });
    document.getElementById('privateFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE_BYTES) {
            showToast('File terlalu besar. Maksimal 10 Mb.');
            e.target.value = '';
            return;
        }
        state.pendingFile = file;
        setAttachmentPreview({ file, attachment: null });
        e.target.value = '';
    });
    document.getElementById('emojiPrivate').addEventListener('click', () => {
        document.getElementById('emojiPanel').classList.toggle('hidden');
    });
    document.getElementById('emojiPanel').addEventListener('click', (e) => {
        const button = e.target.closest('[data-emoji]');
        if (!button) return;
        const input = document.getElementById('privateMessageInput');
        input.value += button.getAttribute('data-emoji');
        input.focus();
        document.getElementById('emojiPanel').classList.add('hidden');
    });

    document.getElementById('privateAttachmentPreview').addEventListener('click', (e) => {
        const removeBtn = e.target.closest('[data-action="remove"]');
        if (!removeBtn) return;
        state.pendingFile = null;
        setAttachmentPreview({ attachment: null, file: null });
    });

    document.getElementById('privateMessageInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendPrivateMessage();
        } else {
            emitTyping('private');
        }
    });

    document.getElementById('loginTrigger').addEventListener('click', showLoginModal);
    document.getElementById('registerTrigger').addEventListener('click', showRegisterModal);
    document.getElementById('togglePublicCard').addEventListener('click', () => {
        const grid = document.querySelector('.chat2-grid');
        grid.classList.toggle('is-public-narrow');
        document.getElementById('togglePublicCard').classList.toggle('is-expanded', grid.classList.contains('is-public-narrow'));
    });
    document.getElementById('logoutTrigger').addEventListener('click', () => {
        hideIncomingVideoCall();
        endVideoCall(false);
        state.token = null;
        state.user = null;
        state.activeUser = null;
        state.unreadByUser = {};
        localStorage.removeItem('chatToken');
        setAuthState(null);
        document.getElementById('privateMessages').innerHTML = '';
        document.getElementById('userList').innerHTML = '';
        state.pendingFile = null;
        setAttachmentPreview({ attachment: null, file: null });
    });

    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);

    document.getElementById('loginModal').addEventListener('click', (e) => {
        if (e.target.id === 'loginModal') {
            hideModals();
        }
    });

    document.getElementById('registerModal').addEventListener('click', (e) => {
        if (e.target.id === 'registerModal') {
            hideModals();
        }
    });

    document.getElementById('captchaModal').addEventListener('click', (e) => {
        if (e.target.id === 'captchaModal') {
            state.publicPending = null;
            hideCaptchaModal();
        }
    });

    document.getElementById('userList').addEventListener('click', (e) => {
        const target = e.target.closest('[data-username]');
        if (!target) return;
        state.activeUser = target.getAttribute('data-username');
        startPrivateRoomWithUser(state.activeUser);
        if (state.activeUser && state.unreadByUser[state.activeUser]) {
            delete state.unreadByUser[state.activeUser];
        }
    });

};

const connectWs = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    state.ws = new WebSocket(`${protocol}://${window.location.host}`);

    state.ws.addEventListener('open', () => {
        if (state.token) {
            sendWs({ type: 'auth', token: state.token });
        }
        sendWs({ type: 'join_public' });
        if (state.privateRoomId) {
            sendWs({ type: 'join_private', roomId: state.privateRoomId });
        }
    });

    state.ws.addEventListener('message', async (event) => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            return;
        }

        if (payload.type === 'public_message') {
            appendMessages(document.getElementById('publicMessages'), [payload.message]);
            return;
        }

        if (payload.type === 'private_message') {
            if (payload.roomId === state.privateRoomId) {
                const isOwn = state.user && (payload.message.username === (state.user.displayName || state.user.username));
                if (isOwn && !payload.message.status) {
                    payload.message.status = 'send';
                }
                appendMessages(document.getElementById('privateMessages'), [payload.message], { showStatus: true });
                if (!isOwn) {
                    markPrivateRead();
                }
            } else if (state.user) {
                const isOwn = payload.message.username === (state.user.displayName || state.user.username);
                if (!isOwn) {
                    const key = payload.message.username;
                    state.unreadByUser[key] = (state.unreadByUser[key] || 0) + 1;
                    const users = await apiRequest('/api/users');
                    renderUsers(users);
                }
            }
            return;
        }

        if (payload.type === 'typing') {
            showTyping(payload.scope, payload.username);
            return;
        }

        if (payload.type === 'captcha_error') {
            showPublicNotice('Captcha salah');
            await refreshCaptcha();
            return;
        }

        if (payload.type === 'read_receipt') {
            if (payload.roomId !== state.privateRoomId) {
                return;
            }
            const statuses = document.querySelectorAll('#privateMessages .chat2-message.is-own .chat2-message-status');
            statuses.forEach((node) => {
                node.textContent = 'Read';
            });
            return;
        }

        if (payload.type === 'video_call_offer') {
            showIncomingVideoCall(payload);
            return;
        }
        if (payload.type === 'video_call_answer') {
            handleVideoCallAnswer(payload);
            return;
        }
        if (payload.type === 'video_call_ice') {
            handleVideoCallIce(payload);
            return;
        }
        if (payload.type === 'video_call_end') {
            if (state.pendingVideoCallOffer) {
                hideIncomingVideoCall();
            } else {
                endVideoCall(false);
            }
            return;
        }
        if (payload.type === 'video_call_decline') {
            endVideoCall(false);
            showToast('Panggilan ditolak');
            return;
        }

        if (payload.type === 'video_call_system_message') {
            if (payload.roomId === state.privateRoomId && payload.message) {
                const container = document.getElementById('privateMessages');
                if (container) {
                    appendMessages(container, [{ ...payload.message, system: true }], { showStatus: true });
                }
            }
            return;
        }

        if (payload.type === 'auth_ok') {
            setAuthState(payload.user);
            loadPrivateData();
            return;
        }
    });
};

const bootstrap = async () => {
    const guestName = localStorage.getItem('guestName');
    if (guestName) {
        document.getElementById('guestName').value = guestName;
    }

    attachEvents();
    setAuthState(null);
    await initPublicRoom();
    connectWs();

    if (state.token) {
        try {
            const me = await apiRequest('/api/users/me');
            setAuthState(me);
            await loadPrivateData();
        } catch (error) {
            state.token = null;
            localStorage.removeItem('chatToken');
        }
    }
};

bootstrap();
