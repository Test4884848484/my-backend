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

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 🔧 СОЗДАНИЕ ТАБЛИЦ ПРИ ЗАПУСКЕ
async function createTables() {
  try {
    console.log('🔧 Создаем таблицы в PostgreSQL...');

    // Таблица пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(255),
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        photo_url TEXT,
        balance INTEGER DEFAULT 0,
        referral_code VARCHAR(50) UNIQUE,
        referred_by BIGINT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица users создана');

    // Таблица рефералов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referred_id BIGINT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (referrer_id) REFERENCES users(user_id),
        FOREIGN KEY (referred_id) REFERENCES users(user_id)
      )
    `);
    console.log('✅ Таблица referrals создана');

    // Таблица транзакций
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      )
    `);
    console.log('✅ Таблица transactions создана');

    // Старая таблица messages (если нужна)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица messages создана');

  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

// 🔧 ФУНКЦИЯ ДЛЯ ГЕНЕРАЦИИ РЕФЕРАЛЬНОГО КОДА
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 🔧 ПОЛУЧИТЬ ИЛИ СОЗДАТЬ ПОЛЬЗОВАТЕЛЯ
async function getOrCreateUser(userData) {
  try {
    const { user_id, username, first_name, last_name, photo_url } = userData;

    // Проверяем существует ли пользователь
    const userResult = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [user_id]
    );

    if (userResult.rows.length > 0) {
      console.log('✅ Пользователь найден:', user_id);
      return userResult.rows[0];
    }

    // Создаем нового пользователя
    const referralCode = generateReferralCode();
    const newUserResult = await pool.query(
      `INSERT INTO users (user_id, username, first_name, last_name, photo_url, referral_code) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [user_id, username, first_name, last_name, photo_url, referralCode]
    );

    console.log('✅ Новый пользователь создан:', user_id);
    return newUserResult.rows[0];

  } catch (err) {
    console.error('❌ Ошибка в getOrCreateUser:', err);
    throw err;
  }
}

// 🔧 ОБРАБОТКА РЕФЕРАЛА
async function processReferral(referredUserId, referralCode) {
  try {
    // Находим пользователя по реферальному коду
    const referrerResult = await pool.query(
      'SELECT user_id FROM users WHERE referral_code = $1',
      [referralCode]
    );

    if (referrerResult.rows.length === 0) {
      console.log('❌ Реферальный код не найден:', referralCode);
      return false;
    }

    const referrerId = referrerResult.rows[0].user_id;

    // Проверяем чтобы пользователь не мог быть своим же рефералом
    if (referrerId === referredUserId) {
      console.log('❌ Пользователь не может быть своим рефералом');
      return false;
    }

    // Проверяем не был ли уже зарегистрирован этот реферал
    const existingReferral = await pool.query(
      'SELECT * FROM referrals WHERE referred_id = $1',
      [referredUserId]
    );

    if (existingReferral.rows.length > 0) {
      console.log('❌ Реферал уже зарегистрирован');
      return false;
    }

    // Добавляем запись о реферале
    await pool.query(
      'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
      [referrerId, referredUserId]
    );

    // Начисляем бонус рефереру
    await pool.query(
      'UPDATE users SET balance = balance + 10 WHERE user_id = $1',
      [referrerId]
    );

    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, description) 
       VALUES ($1, $2, $3, $4)`,
      [referrerId, 10, 'referral', `Реферальный бонус от пользователя ${referredUserId}`]
    );

    console.log('✅ Реферал обработан:', referredUserId, '->', referrerId);
    return true;

  } catch (err) {
    console.error('❌ Ошибка в processReferral:', err);
    return false;
  }
}

// 📡 МАРШРУТЫ API

// Главная страница API
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API работает!', 
    database: 'PostgreSQL на Railway',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/user/:userId',
      'POST /api/user',
      'GET /api/messages',
      'POST /api/messages'
    ]
  });
});

// 🔧 ПОЛУЧИТЬ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userResult = await pool.query(`
      SELECT u.*, COUNT(r.id) as referral_count
      FROM users u
      LEFT JOIN referrals r ON u.user_id = r.referrer_id
      WHERE u.user_id = $1
      GROUP BY u.id
    `, [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(userResult.rows[0]);
  } catch (err) {
    console.error('❌ Ошибка получения пользователя:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 СОЗДАТЬ/ОБНОВИТЬ ПОЛЬЗОВАТЕЛЯ
app.post('/api/user', async (req, res) => {
  try {
    const { user_id, username, first_name, last_name, photo_url, referral_code } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Создаем/обновляем пользователя
    const user = await getOrCreateUser({
      user_id, username, first_name, last_name, photo_url
    });

    // Обрабатываем реферала если есть код
    if (referral_code) {
      await processReferral(user_id, referral_code);
    }

    // Получаем обновленные данные пользователя
    const userResult = await pool.query(`
      SELECT u.*, COUNT(r.id) as referral_count
      FROM users u
      LEFT JOIN referrals r ON u.user_id = r.referrer_id
      WHERE u.user_id = $1
      GROUP BY u.id
    `, [user_id]);

    res.json(userResult.rows[0]);

  } catch (err) {
    console.error('❌ Ошибка создания пользователя:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ (для теста)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, COUNT(r.id) as referral_count
      FROM users u
      LEFT JOIN referrals r ON u.user_id = r.referrer_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Ошибка получения пользователей:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 📝 СТАРЫЕ МАРШРУТЫ ДЛЯ СООБЩЕНИЙ
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const result = await pool.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING *',
      [text]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 🚀 ЗАПУСК СЕРВЕРА
app.listen(port, async () => {
  console.log(`🚀 Сервер запущен на порту ${port}`);
  console.log('🔧 Инициализация базы данных...');
  
  try {
    await createTables();
    console.log('✅ Все таблицы готовы!');
    
    // Проверяем подключение
    const testResult = await pool.query('SELECT NOW() as time');
    console.log('✅ Подключение к базе:', testResult.rows[0].time);
    
  } catch (err) {
    console.error('❌ Ошибка инициализации:', err);
  }
});
