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

// 🔧 ДЕБАГ: Выведем информацию о DATABASE_URL
console.log('🔧 Анализ DATABASE_URL:');
if (process.env.DATABASE_URL) {
  const dbUrl = process.env.DATABASE_URL;
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@');
  console.log('- DATABASE_URL:', maskedUrl);
  
  // Парсим URL для информации
  try {
    const url = new URL(dbUrl);
    console.log('- Хост:', url.hostname);
    console.log('- Порт:', url.port);
    console.log('- База:', url.pathname.replace('/', ''));
    console.log('- Пользователь:', url.username);
  } catch (e) {
    console.log('- Ошибка парсинга URL:', e.message);
  }
} else {
  console.log('- DATABASE_URL: не установлен');
}

// 🔧 ИСПОЛЬЗУЕМ ТОЛЬКО DATABASE_URL
let pool;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });
    console.log('✅ Пул подключения создан');
  } catch (err) {
    console.error('❌ Ошибка создания пула:', err.message);
  }
} else {
  console.error('❌ DATABASE_URL не установлен!');
}

// Проверка подключения к базе
async function testConnection() {
  if (!pool) {
    console.error('❌ Пул не инициализирован');
    return false;
  }

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
    return false;
  }
}

// Создание таблицы при запуске
async function initDatabase() {
  if (!pool) return false;

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
    
    // Добавим тестовое сообщение если таблица пустая
    if (count === 0) {
      await pool.query("INSERT INTO messages (text) VALUES ('🎉 Привет! База данных работает!')");
      console.log('✅ Добавлено тестовое сообщение');
    }
    
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
    database: process.env.DATABASE_URL ? 'PostgreSQL на Railway' : 'не настроена',
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
  if (!pool) {
    return res.status(500).json({ 
      error: 'Database not configured',
      message: 'База данных не настроена'
    });
  }

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
  if (!pool) {
    return res.status(500).json({ 
      error: 'Database not configured',
      message: 'База данных не настроена'
    });
  }

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
  if (!pool) {
    return res.status(500).json({ 
      error: 'Database not configured',
      message: 'База данных не настроена'
    });
  }

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
  if (!pool) {
    return res.status(500).json({
      status: 'error',
      database: 'not configured',
      timestamp: new Date().toISOString()
    });
  }

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
  
  if (process.env.DATABASE_URL) {
    console.log('🔧 Инициализация базы данных...');
    const dbConnected = await testConnection();
    
    if (dbConnected) {
      await initDatabase();
      console.log('✅ Приложение готово к работе!');
    } else {
      console.log('⚠️ Приложение запущено, но база данных не подключена');
    }
  } else {
    console.log('❌ DATABASE_URL не установлен!');
    console.log('💡 Добавь базу данных в проект Railway или установи переменную DATABASE_URL');
  }
});
