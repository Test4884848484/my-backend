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

// 🔧 ФУНКЦИЯ ДЛЯ УДАЛЕНИЯ ВСЕХ ТАБЛИЦ
async function dropAllTables() {
  try {
    console.log('🗑️ Удаление всех таблиц...');
    
    // Удаляем таблицы в правильном порядке (из-за foreign keys)
    await pool.query('DROP TABLE IF EXISTS raffle_participants CASCADE');
    await pool.query('DROP TABLE IF EXISTS case_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS user_inventory CASCADE');
    await pool.query('DROP TABLE IF EXISTS referrals CASCADE');
    await pool.query('DROP TABLE IF EXISTS transactions CASCADE');
    await pool.query('DROP TABLE IF EXISTS raffles CASCADE');
    await pool.query('DROP TABLE IF EXISTS cases CASCADE');
    await pool.query('DROP TABLE IF EXISTS user_data CASCADE');
    await pool.query('DROP TABLE IF EXISTS messages CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('✅ Все таблицы удалены!');
  } catch (err) {
    console.error('❌ Ошибка удаления таблиц:', err);
  }
}

// 🔧 API ДЛЯ УДАЛЕНИЯ ТАБЛИЦ
app.delete('/api/admin/drop-tables', async (req, res) => {
  try {
    await dropAllTables();
    res.json({ success: true, message: 'Все таблицы удалены' });
  } catch (err) {
    console.error('Error dropping tables:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 СОЗДАНИЕ ВСЕХ ТАБЛИЦ
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
        created_at TIMESTAMP DEFAULT NOW()
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
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица transactions создана');

    // Таблица messages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица messages создана');

    // Таблица user_data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        balance INTEGER DEFAULT 0,
        daily_bonus_count INTEGER DEFAULT 0,
        daily_bonus_last_claim TIMESTAMP,
        daily_bonus_current_reward INTEGER DEFAULT 10,
        subscribe_completed INTEGER DEFAULT 0,
        subscribe_last_claim TIMESTAMP,
        name_completed INTEGER DEFAULT 0,
        name_last_claim TIMESTAMP,
        ref_desc_completed INTEGER DEFAULT 0,
        ref_desc_last_claim TIMESTAMP,
        referral_last_claim TIMESTAMP,
        cases_opened INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        referrals INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица user_data создана');
    
    // Таблица user_inventory
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_inventory (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        item_price VARCHAR(50) NOT NULL,
        item_image TEXT,
        obtained_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица user_inventory создана');

    // Таблица cases
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price INTEGER NOT NULL,
        image TEXT,
        total_opened INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица cases создана');
    
    // Таблица case_items
    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_items (
        id SERIAL PRIMARY KEY,
        case_id INTEGER REFERENCES cases(id),
        name VARCHAR(255) NOT NULL,
        price VARCHAR(50) NOT NULL,
        image TEXT,
        rarity VARCHAR(50) DEFAULT 'common'
      )
    `);
    console.log('✅ Таблица case_items создана');
    
    // Таблица raffles
    await pool.query(`
      CREATE TABLE IF NOT EXISTS raffles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        image TEXT,
        end_date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица raffles создана');
    
    // Таблица raffle_participants
    await pool.query(`
      CREATE TABLE IF NOT EXISTS raffle_participants (
        id SERIAL PRIMARY KEY,
        raffle_id INTEGER REFERENCES raffles(id),
        user_id BIGINT NOT NULL,
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(raffle_id, user_id)
      )
    `);
    console.log('✅ Таблица raffle_participants создана');

    console.log('✅ Все таблицы созданы успешно!');
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

    const userResult = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [user_id]
    );

    if (userResult.rows.length > 0) {
      console.log('✅ Пользователь найден:', user_id);
      return userResult.rows[0];
    }

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

// 📡 ОСНОВНЫЕ API МАРШРУТЫ

app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API работает!', 
    database: 'PostgreSQL на Railway',
    timestamp: new Date().toISOString()
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

// 🔧 ПОЛУЧИТЬ ПОЛНЫЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user/full/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    const dataResult = await pool.query(
      'SELECT * FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    let userData = {
      balance: user.balance || 0,
      daily_bonus: { count: 0, last_claim: null, current_reward: 10 },
      quests: {
        subscribe: { completed: 0, last_claim: null },
        name: { completed: 0, last_claim: null },
        ref_desc: { completed: 0, last_claim: null }
      },
      referrals: user.referral_count || 0,
      cases_opened: 0,
      inventory: [],
      level: 1
    };
    
    if (dataResult.rows.length > 0) {
      const data = dataResult.rows[0];
      userData = {
        balance: data.balance || user.balance || 0,
        daily_bonus: {
          count: data.daily_bonus_count || 0,
          last_claim: data.daily_bonus_last_claim,
          current_reward: data.daily_bonus_current_reward || 10
        },
        quests: {
          subscribe: { 
            completed: data.subscribe_completed || 0, 
            last_claim: data.subscribe_last_claim 
          },
          name: { 
            completed: data.name_completed || 0, 
            last_claim: data.name_last_claim 
          },
          ref_desc: { 
            completed: data.ref_desc_completed || 0, 
            last_claim: data.ref_desc_last_claim 
          }
        },
        referrals: data.referrals || user.referral_count || 0,
        referral_last_claim: data.referral_last_claim,
        cases_opened: data.cases_opened || 0,
        level: data.level || 1,
        inventory: []
      };
    }
    
    const inventoryResult = await pool.query(
      'SELECT * FROM user_inventory WHERE user_id = $1 ORDER BY obtained_at DESC',
      [userId]
    );
    
    userData.inventory = inventoryResult.rows.map(item => ({
      name: item.item_name,
      price: item.item_price,
      image: item.item_image
    }));
    
    res.json({
      user: user,
      data: userData
    });
    
  } catch (err) {
    console.error('Error getting full user data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 СОХРАНИТЬ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
app.post('/api/user/data/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userData = req.body;
    
    const result = await pool.query(
      `INSERT INTO user_data (
        user_id, balance, daily_bonus_count, daily_bonus_last_claim, 
        daily_bonus_current_reward, subscribe_completed, subscribe_last_claim,
        name_completed, name_last_claim, ref_desc_completed, ref_desc_last_claim,
        referral_last_claim, cases_opened, level, referrals
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        balance = $2,
        daily_bonus_count = $3,
        daily_bonus_last_claim = $4,
        daily_bonus_current_reward = $5,
        subscribe_completed = $6,
        subscribe_last_claim = $7,
        name_completed = $8,
        name_last_claim = $9,
        ref_desc_completed = $10,
        ref_desc_last_claim = $11,
        referral_last_claim = $12,
        cases_opened = $13,
        level = $14,
        referrals = $15,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        userData.balance || 0,
        userData.daily_bonus?.count || 0,
        userData.daily_bonus?.last_claim,
        userData.daily_bonus?.current_reward || 10,
        userData.quests?.subscribe?.completed || 0,
        userData.quests?.subscribe?.last_claim,
        userData.quests?.name?.completed || 0,
        userData.quests?.name?.last_claim,
        userData.quests?.ref_desc?.completed || 0,
        userData.quests?.ref_desc?.last_claim,
        userData.referral_last_claim,
        userData.cases_opened || 0,
        userData.level || 1,
        userData.referrals || 0
      ]
    );
    
    await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2',
      [userData.balance || 0, userId]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saving user data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ОБНОВИТЬ БАЛАНС
app.put('/api/user/:userId/balance', async (req, res) => {
  try {
    const { userId } = req.params;
    const { balance } = req.body;
    
    if (balance === undefined) {
      return res.status(400).json({ error: 'Balance is required' });
    }

    const result = await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2 RETURNING *',
      [balance, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query(
      'UPDATE user_data SET balance = $1 WHERE user_id = $2',
      [balance, userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Ошибка обновления баланса:', err);
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

    const user = await getOrCreateUser({
      user_id, username, first_name, last_name, photo_url
    });

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

// 🔧 ПОЛУЧИТЬ КЕЙСЫ
app.get('/api/cases', async (req, res) => {
  try {
    const testCases = [
      {
        id: 1,
        name: "Кейс Grunt",
        price: 100,
        image: "https://cs-shot.pro/images/new2/Grunt.png",
        total_opened: 1542,
        items: [
          { name: "AK-47 | Redline", price: "1500", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSIf6GDG6D_uJ_t-l9AX_nzBhw4TvWwo6udC2QbgZyWcN2RuMP4xHrlYDnYezm7geP3d5FyH3gznQeY_Oe4QY" },
          { name: "AWP | Dragon Lore", price: "10000", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwiFO0P_6afBSJeaaAliUwOd7qe5WQyC0nQlp4GqGz42ucCqXaQMhDpd4R-AIsxK6ktXgZePltVPXitoRn3-tjCgd6zErvbijVJZd2Q" }
        ]
      }
    ];
    
    res.json(testCases);
  } catch (err) {
    console.error('Error getting cases:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПОЛУЧИТЬ РОЗЫГРЫШИ
app.get('/api/raffles', async (req, res) => {
  try {
    const testRaffles = [
      { 
        id: 1, 
        name: 'AK-47 | Годовая подписка', 
        end_date: '2024-12-31T23:59:59', 
        participants: 1245,
        image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSIf6GDG6D_uJ_t-l9AX_nzBhw4TvWwo6udC2QbgZyWcN2RuMP4xHrlYDnYezm7geP3d5FyH3gznQeY_Oe4QY'
      }
    ];
    
    res.json(testRaffles);
  } catch (err) {
    console.error('Error getting raffles:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 HEALTH CHECK
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
      error: err.message 
    });
  }
});

// 🚀 ЗАПУСК СЕРВЕРА
app.listen(port, async () => {
  console.log(`🚀 Сервер запущен на порту ${port}`);
  console.log('🔧 Инициализация базы данных...');
  
  try {
    // Если нужно удалить таблицы - раскомментируйте следующую строку:
    // await dropAllTables();
    
    await createTables();
    console.log('✅ Все таблицы готовы!');
    
    const testResult = await pool.query('SELECT NOW() as time');
    console.log('✅ Подключение к базе:', testResult.rows[0].time);
    
  } catch (err) {
    console.error('❌ Ошибка инициализации:', err);
  }
});
