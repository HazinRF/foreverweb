const WebSocket = require('ws');
const http = require('http');

// Создаем HTTP сервер
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket сервер для нашего сайта\n');
});

// Создаем WebSocket сервер
const wss = new WebSocket.Server({ 
    server,
    // Увеличиваем лимит размера сообщения (на всякий случай)
    maxPayload: 10 * 1024 * 1024 // 10MB
});

// Хранилище данных (теперь храним только активные линии)
const activeLines = new Map();
const users = new Map();

console.log('🟢 Сервер инициализирован. Ожидание подключений...');

// Обработка подключений
wss.on('connection', (ws, req) => {
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`✅ [${userId}] Новое подключение с IP: ${req.socket.remoteAddress}`);
    
    users.set(userId, { ws, color: null, name: null });
    
    // Отправляем количество пользователей всем
    broadcastUserCount();
    
    // Обработка сообщений от клиента
    ws.on('message', (message) => {
        try {
            // Проверяем, что сообщение - строка
            if (typeof message !== 'string') {
                message = message.toString('utf8');
            }
            
            const data = JSON.parse(message);
            handleClientMessage(userId, data);
        } catch (error) {
            console.error(`❌ [${userId}] Ошибка обработки сообщения:`, error.message);
            // Не обрываем соединение при ошибке в сообщении
        }
    });
    
    // Обработка отключения
    ws.on('close', () => {
        console.log(`🔴 [${userId}] Отключение`);
        users.delete(userId);
        broadcastUserCount();
        
        // Удаляем ВСЕ линии при отключении пользователя (опционально)
        // Если хотите, чтобы линии оставались, закомментируйте этот блок
        for (const [lineId, line] of activeLines) {
            if (line.userId === userId) {
                activeLines.delete(lineId);
            }
        }
    });
    
    ws.on('error', (error) => {
        console.error(`⚠️ [${userId}] WebSocket ошибка:`, error.message);
    });
});

// Обработка сообщений от клиента
function handleClientMessage(userId, data) {
    const user = users.get(userId);
    if (!user) return;
    
    try {
        switch (data.type) {
            case 'user_join':
                user.color = data.userColor || '#000000';
                user.name = data.userName || 'Аноним';
                user.platform = data.platform || 'unknown';
                console.log(`👤 [${userId}] ${user.name} (${user.platform}) присоединился`);
                break;
                
            case 'line_start':
                // Сохраняем новую линию
                activeLines.set(data.lineId, {
                    lineId: data.lineId,
                    userId: userId,
                    userColor: data.userColor || user.color,
                    points: [data.point],
                    platform: data.platform,
                    createdAt: Date.now()
                });
                
                // Рассылаем всем, кроме отправителя
                broadcast({
                    type: 'line_start',
                    lineId: data.lineId,
                    point: data.point,
                    userColor: data.userColor || user.color,
                    userId: userId,
                    platform: data.platform
                }, userId);
                break;
                
            case 'line_update':
                // Обновляем линию
                const line = activeLines.get(data.lineId);
                if (line && line.userId === userId) {
                    line.points.push(data.point);
                    
                    // Ограничиваем количество точек для оптимизации (не более 500)
                    if (line.points.length > 500) {
                        line.points = line.points.slice(-500);
                    }
                    
                    broadcast({
                        type: 'line_update',
                        lineId: data.lineId,
                        point: data.point
                    }, userId);
                }
                break;
                
            case 'line_end':
                // Помечаем линию как завершенную
                const endLine = activeLines.get(data.lineId);
                if (endLine && endLine.userId === userId) {
                    // Устанавливаем время окончания
                    endLine.endedAt = Date.now();
                    
                    // Планируем удаление через 5 секунд
                    setTimeout(() => {
                        activeLines.delete(data.lineId);
                    }, 5000);
                    
                    broadcast({
                        type: 'line_end',
                        lineId: data.lineId
                    }, userId);
                }
                break;
                
            case 'ping':
                // Отвечаем на пинг-сообщение для поддержания соединения
                if (user.ws.readyState === WebSocket.OPEN) {
                    user.ws.send(JSON.stringify({ type: 'pong' }));
                }
                break;
                
            default:
                console.log(`ℹ️ [${userId}] Неизвестный тип сообщения:`, data.type);
        }
    } catch (error) {
        console.error(`❌ [${userId}] Ошибка в handleClientMessage:`, error);
    }
}

// Функция рассылки сообщения всем клиентам
function broadcast(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    
    for (const [userId, user] of users) {
        if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
            try {
                user.ws.send(message);
            } catch (error) {
                console.error(`⚠️ [${userId}] Ошибка при отправке:`, error.message);
            }
        }
    }
}

// Рассылка количества пользователей
function broadcastUserCount() {
    const count = users.size;
    const message = JSON.stringify({
        type: 'user_count',
        count: count
    });
    
    for (const [userId, user] of users) {
        if (user.ws.readyState === WebSocket.OPEN) {
            try {
                user.ws.send(message);
            } catch (error) {
                console.error(`⚠️ [${userId}] Ошибка при отправке количества:`, error.message);
            }
        }
    }
    
    console.log(`👥 Пользователей онлайн: ${count}`);
}

// Очистка старых линий (каждые 30 секунд)
setInterval(() => {
    const now = Date.now();
    let deleted = 0;
    
    for (const [lineId, line] of activeLines) {
        // Удаляем линии, которые закончились более 10 секунд назад
        if (line.endedAt && (now - line.endedAt > 10000)) {
            activeLines.delete(lineId);
            deleted++;
        }
        // Удаляем "зависшие" линии без окончания старше 2 минут
        else if (!line.endedAt && (now - line.createdAt > 120000)) {
            activeLines.delete(lineId);
            deleted++;
        }
    }
    
    if (deleted > 0) {
        console.log(`🧹 Удалено старых линий: ${deleted}`);
    }
}, 30000);

// Запуск сервера
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 WebSocket доступен по адресу: ws://localhost:${PORT}`);
    console.log(`🔄 Для публичного доступа: wss://our-drawing-site.onrender.com`);
});