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

// 🔧 ДЕБАГ: Выведем все переменные связанные с БД
console.log('🔧 Все переменные PostgreSQL:');
console.log('- DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'не установлен');
console.log('- PGHOST:', process.env.PGHOST);
console.log('- PGPORT:', process.env.PGPORT);
console.log('- PGDATABASE:', process.env.PGDATABASE);
console.log('- PGUSER:', process.env.PGUSER);
console.log('- PGPASSWORD:', process.env.PGPASSWORD ? '****' : 'не установлен');

// 🔧 ВАРИАНТ 1: Попробуем использовать отдельные переменные сначала
let connectionConfig;

if (process.env.PGHOST && process.env.PGPORT) {
  // Используем отдельные переменные
  console.log('🔧 Используем отдельные переменные PGHOST/PGPORT');
  connectionConfig = {
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE || 'railway',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
    ssl: {
      rejectUnauthorized: false
    }
  };
} else if (process.env.DATABASE_URL) {
  // Используем DATABASE_URL
  console.log('🔧 Используем DATABASE_URL');
  connectionConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  };
} else {
  console.error('❌ Нет переменных для подключения к базе!');
}

console.log('🔧 Финальная конфигурация:');
console.log('- Хост:', connectionConfig?.host || connectionConfig?.connectionString?.split('@')[1]?.split(':')[0]);
console.log('- Порт:', connectionConfig?.port || connectionConfig?.connectionString?.split(':').pop()?.split('/')[0]);

// Подключение к PostgreSQL
const pool = new Pool(connectionConfig);

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

// 🔧 ПРОСТОЙ ТЕСТ БЕЗ БАЗЫ ДАННЫХ
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API работает!', 
    status: 'База данных настраивается...',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ 
      error: 'Database not available', 
      message: 'База данных временно недоступна',
      details: err.message 
    });
  }
});

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
    res.status(500).json({ 
      error: 'Database not available', 
      message: 'Не удалось сохранить сообщение',
      details: err.message 
    });
  }
});

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
    console.log('💡 Проверь что база данных привязана к проекту в Railway');
  }
});
