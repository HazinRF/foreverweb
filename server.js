const WebSocket = require('ws');
const http = require('http');

// Создаем HTTP сервер
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket сервер для нашего сайта\n');
});

// Создаем WebSocket сервер
const wss = new WebSocket.Server({ server });

// Хранилище данных
const activeLines = new Map();
const users = new Map();
let userCounter = 0;

// Обработка подключений
wss.on('connection', (ws) => {
    const userId = `user_${++userCounter}`;
    console.log(`✅ Новое подключение: ${userId}`);
    
    // Сохраняем соединение
    users.set(userId, { ws, color: null, name: null });
    
    // Отправляем количество пользователей всем
    broadcastUserCount();
    
    // Обработка сообщений от клиента
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(userId, data);
        } catch (error) {
            console.error('Ошибка парсинга сообщения:', error);
        }
    });
    
    // Обработка отключения
    ws.on('close', () => {
        console.log(`❌ Отключение: ${userId}`);
        users.delete(userId);
        
        // Удаляем все линии этого пользователя
        for (const [lineId, line] of activeLines) {
            if (line.userId === userId) {
                activeLines.delete(lineId);
            }
        }
        
        broadcastUserCount();
        broadcast({ type: 'clear_lines' });
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
    });
});

// Обработка сообщений от клиента
function handleClientMessage(userId, data) {
    const user = users.get(userId);
    
    switch (data.type) {
        case 'user_join':
            user.color = data.userColor;
            user.name = data.userName;
            user.platform = data.platform;
            console.log(`👤 ${data.userName} (${data.platform}) присоединился`);
            break;
            
        case 'line_start':
            // Сохраняем новую линию
            activeLines.set(data.lineId, {
                ...data,
                userId: userId,
                points: [data.point]
            });
            
            // Рассылаем всем, кроме отправителя
            broadcast(data, userId);
            break;
            
        case 'line_update':
            // Обновляем линию
            const line = activeLines.get(data.lineId);
            if (line && line.userId === userId) {
                line.points.push(data.point);
                broadcast(data, userId);
            }
            break;
            
        case 'line_end':
            // Помечаем линию как завершенную
            const endLine = activeLines.get(data.lineId);
            if (endLine && endLine.userId === userId) {
                // Через 5 секунд удаляем линию
                setTimeout(() => {
                    activeLines.delete(data.lineId);
                    broadcast({ type: 'clear_lines' });
                }, 5000);
                
                broadcast(data, userId);
            }
            break;
    }
}

// Функция рассылки сообщения всем клиентам
function broadcast(data, excludeUserId = null) {
    const message = JSON.stringify(data);
    
    for (const [userId, user] of users) {
        if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(message);
        }
    }
}

// Рассылка количества пользователей
function broadcastUserCount() {
    broadcast({
        type: 'user_count',
        count: users.size
    });
}

// Запуск сервера
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📡 WebSocket доступен по адресу: ws://localhost:${PORT}`);
});