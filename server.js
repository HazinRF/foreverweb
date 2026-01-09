const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket сервер для нашего сайта\n');
});

const wss = new WebSocket.Server({ server });
const users = new Map(); // Только подключения
const activeLines = new Map(); // Активные линии для новых пользователей

console.log('🟢 Сервер инициализирован');

// Обработка подключений
wss.on('connection', (ws, req) => {
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`✅ [${userId}] Новое подключение`);
    
    users.set(userId, { ws });
    
    // 1. Сразу отправляем текущее количество пользователей
    broadcastUserCount();
    
    // 2. Отправляем новому пользователю ВСЕ активные линии
    setTimeout(() => {
        for (const [lineId, line] of activeLines) {
            if (users.get(line.userId)?.ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'line_start',
                    ...line,
                    isReplay: true // Флаг, что это восстановленная линия
                }));
                
                // Отправляем все точки линии
                if (line.points.length > 1) {
                    line.points.forEach(point => {
                        ws.send(JSON.stringify({
                            type: 'line_update',
                            lineId: lineId,
                            point: point
                        }));
                    });
                }
            }
        }
    }, 500);
    
    // Обработка сообщений
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            handleClientMessage(userId, data);
        } catch (error) {
            console.error(`❌ Ошибка обработки сообщения:`, error.message);
        }
    });
    
    ws.on('close', () => {
        console.log(`🔴 [${userId}] Отключение`);
        users.delete(userId);
        broadcastUserCount();
    });
    
    ws.on('error', (error) => {
        console.error(`⚠️ Ошибка WebSocket:`, error.message);
    });
});

// Обработка сообщений
function handleClientMessage(userId, data) {
    switch (data.type) {
        case 'line_start':
            // Сохраняем линию в память сервера
            activeLines.set(data.lineId, {
                lineId: data.lineId,
                userId: userId,
                userColor: data.userColor,
                points: [data.point],
                startTime: Date.now(),
                fading: false
            });
            
            // Рассылаем всем ДРУГИМ пользователям
            broadcast({
                type: 'line_start',
                lineId: data.lineId,
                point: data.point,
                userColor: data.userColor,
                userId: userId
            }, userId);
            break;
            
        case 'line_update':
            // Обновляем линию на сервере
            const line = activeLines.get(data.lineId);
            if (line && line.userId === userId) {
                line.points.push(data.point);
                // Ограничиваем длину для оптимизации
                if (line.points.length > 100) {
                    line.points = line.points.slice(-100);
                }
                
                // Рассылаем обновление
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
                endLine.fading = true;
                endLine.endTime = Date.now();
                
                // Рассылаем событие окончания ВСЕМ (включая отправителя!)
                broadcastToAll({
                    type: 'line_end',
                    lineId: data.lineId,
                    endTime: endLine.endTime // Важно: синхронизированное время
                });
                
                // Удаляем с сервера через 5 секунд
                setTimeout(() => {
                    activeLines.delete(data.lineId);
                }, 5000);
            }
            break;
            
        case 'tap':
            // Обработка тапов
            broadcast({
                type: 'tap',
                point: data.point,
                userColor: data.userColor,
                userId: userId,
                tapTime: Date.now()
            }, userId);
            break;
    }
}

// Рассылка всем, кроме указанного пользователя
function broadcast(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    for (const [userId, user] of users) {
        if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    }
}

// Рассылка ВСЕМ пользователям (важно для синхронизации)
function broadcastToAll(data) {
    const message = JSON.stringify(data);
    for (const [userId, user] of users) {
        if (user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    }
}

// Рассылка количества пользователей
function broadcastUserCount() {
    const count = users.size;
    broadcastToAll({
        type: 'user_count',
        count: count
    });
    console.log(`👥 Пользователей онлайн: ${count}`);
}

// Запуск сервера
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});