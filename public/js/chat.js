
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
    publicPending: null
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


const renderAttachment = (attachment) => {
    if (!attachment) {
        return '';
    }
    if (attachment.type && attachment.type.startsWith('image/')) {
        return `<div class="chat2-attachment"><img src="${attachment.url}" alt="${attachment.name || 'image'}" /></div>`;
    }
    const label = attachment.name || attachment.url;
    return `<div class="chat2-attachment"><a href="${attachment.url}" target="_blank">${label}</a></div>`;
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

const renderMessages = (container, messages, options = {}) => {
    const showStatus = options.showStatus || false;
    container.innerHTML = messages.map((msg) => {
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
                    ${renderAttachment(msg.attachment)}
                    ${status}
                </div>
            </div>
        `;
    }).join('');
    container.scrollTop = container.scrollHeight;
};

const appendMessages = (container, messages, options = {}) => {
    const showStatus = options.showStatus || false;
    const html = messages.map((msg) => {
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
                    ${renderAttachment(msg.attachment)}
                    ${status}
                </div>
            </div>
        `;
    }).join('');
    container.insertAdjacentHTML('beforeend', html);
    container.scrollTop = container.scrollHeight;
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

const setAuthState = (user) => {
    state.user = user;
    setUserLabel(user ? user.displayName : 'Guest');
    document.getElementById('loginTrigger').classList.toggle('hidden', !!user);
    document.getElementById('registerTrigger').classList.toggle('hidden', !!user);
    document.getElementById('logoutTrigger').classList.toggle('hidden', !user);
    document.getElementById('privateMessageInput').disabled = !user || !state.privateRoomId;
    document.getElementById('sendPrivate').disabled = !user || !state.privateRoomId;
    document.getElementById('attachPrivate').disabled = !user;
    document.getElementById('emojiPrivate').disabled = !user;
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
    renderUsers(users);
    const rooms = await apiRequest('/api/rooms/private');
    renderPrivateRooms(rooms);
    if (!state.privateRoomId && rooms.length > 0) {
        await openPrivateRoom(rooms[0].id);
    }
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
    document.getElementById('privateMessageInput').disabled = !state.user;
    document.getElementById('sendPrivate').disabled = !state.user;
    document.getElementById('attachPrivate').disabled = !state.user;
    document.getElementById('emojiPrivate').disabled = !state.user;
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


const uploadPrivateFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
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
        activeAttachment = await uploadPrivateFile(state.pendingFile);
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

    document.getElementById('sendPrivate').addEventListener('click', () => sendPrivateMessage());
    document.getElementById('attachPrivate').addEventListener('click', () => {
        document.getElementById('privateFileInput').click();
    });
    document.getElementById('privateFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
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
        state.token = null;
        state.user = null;
        state.activeUser = null;
        state.unreadByUser = {};
        localStorage.removeItem('chatToken');
        setAuthState(null);
        document.getElementById('privateMessages').innerHTML = '';
        document.getElementById('userList').innerHTML = '';
        // private rooms list hidden
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
