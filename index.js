require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

// 🔧 ИСПОЛЬЗУЕМ ДРУГОЕ ИМЯ ПЕРЕМЕННОЙ чтобы избежать конфликта
const databaseUrl = process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL;

console.log('🔧 Проверяем переменные окружения:');
console.log('- EXTERNAL_DATABASE_URL:', process.env.EXTERNAL_DATABASE_URL ? 'установлен' : 'не установлен');
console.log('- DATABASE_URL:', process.env.DATABASE_URL ? 'установлен' : 'не установлен');

if (!databaseUrl) {
  console.error('❌ Ни одна переменная базы данных не установлена!');
}

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

// Проверка подключения к базе
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL подключена успешно!');
    
    // Покажем информацию о БД
    const dbResult = await client.query('SELECT current_database(), version()');
    console.log(`📊 База данных: ${dbResult.rows[0].current_database}`);
    
    client.release();
    return true;
  } catch (err) {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    console.log('🔧 Используемый URL:', databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':****@') : 'не установлен');
    return false;
  }
}

// Создание таблицы при запуске
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица messages готова');
    
    // Проверим данные
    const result = await pool.query('SELECT COUNT(*) as count FROM messages');
    const count = parseInt(result.rows[0].count);
    console.log(`📊 В таблице ${count} сообщений`);
    
    return true;
  } catch (err) {
    console.error('❌ Ошибка инициализации базы:', err.message);
    return false;
  }
}

// Маршруты API

// Главная страница API
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API работает!', 
    database: 'PostgreSQL на Railway',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/messages',
      'POST /api/messages', 
      'DELETE /api/messages/:id',
      'GET /health'
    ]
  });
});

// Получить все сообщения
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Ошибка получения сообщений:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Добавить новое сообщение
app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const result = await pool.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING *',
      [text.trim()]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Ошибка добавления сообщения:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Удалить сообщение
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('DELETE FROM messages WHERE id = $1 RETURNING *', [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    res.json({ message: 'Message deleted', deleted: result.rows[0] });
  } catch (err) {
    console.error('❌ Ошибка удаления сообщения:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Проверка здоровья API
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Запуск сервера
app.listen(port, async () => {
  console.log(`🚀 Сервер запущен на порту ${port}`);
  console.log('🔧 Инициализация базы данных...');
  
  const dbConnected = await testConnection();
  
  if (dbConnected) {
    await initDatabase();
    console.log('✅ Приложение готово к работе!');
  } else {
    console.log('⚠️ Приложение запущено, но база данных не подключена');
  }
});
