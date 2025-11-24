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

// 🔧 TELEGRAM BOT API ИНТЕГРАЦИЯ
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN || "8308720989:AAHFS_9JXHB7T6UufDuQB9W-xjWTPU-x0lY";
const TELEGRAM_CHANNEL = "@CS2DropZone";

// 🔧 СОЗДАНИЕ ВСЕХ ТАБЛИЦ ПРИ ЗАПУСКЕ
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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
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

    // Старая таблица messages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица messages создана');

    // 🔧 НОВЫЕ ТАБЛИЦЫ ДЛЯ ДАННЫХ ПОЛЬЗОВАТЕЛЯ
    await createAdditionalTables();

  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

// 🔧 СОЗДАНИЕ ДОПОЛНИТЕЛЬНЫХ ТАБЛИЦ
async function createAdditionalTables() {
  try {
    // Таблица для данных пользователя с отдельными колонками для времени
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        balance INTEGER DEFAULT 0,
        
        -- Подписка на канал
        is_subscribed BOOLEAN DEFAULT FALSE,
        subscribe_count INTEGER DEFAULT 0,
        subscribe_last_claim TIMESTAMP,
        
        -- Имя бота в фамилии
        has_bot_in_bio BOOLEAN DEFAULT FALSE,
        bot_in_bio_count INTEGER DEFAULT 0,
        bot_in_bio_last_claim TIMESTAMP,
        
        -- Реф. ссылка в описании
        has_ref_in_bio BOOLEAN DEFAULT FALSE,
        ref_in_bio_count INTEGER DEFAULT 0,
        ref_in_bio_last_claim TIMESTAMP,
        
        -- Ежедневный бонус
        daily_bonus_count INTEGER DEFAULT 0,
        daily_bonus_last_claim TIMESTAMP,
        daily_bonus_current_reward INTEGER DEFAULT 10,
        
        -- Рефералы
        referral_last_claim TIMESTAMP,
        cases_opened INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        referrals INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица user_data создана');
    
    // Таблица инвентаря пользователя
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

    // Таблица кейсов
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
    
    // Таблица предметов кейсов
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
    
    // Таблица розыгрышей
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
    
    // Таблица участников розыгрышей
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

    console.log('✅ Все дополнительные таблицы созданы');
    
    // 🔧 ДОБАВИМ ЭТУ ФУНКЦИЮ ДЛЯ ОБНОВЛЕНИЯ СТРУКТУРЫ
    await updateTableStructure();
    
  } catch (err) {
    console.error('❌ Ошибка создания дополнительных таблиц:', err);
  }
}

// 🔧 ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ СТРУКТУРЫ ТАБЛИЦ
async function updateTableStructure() {
  try {
    console.log('🔧 Проверяем и обновляем структуру таблиц...');
    
    // Добавляем недостающие колонки в user_data
    const columnsToAdd = [
      { name: 'is_subscribed', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'subscribe_count', type: 'INTEGER DEFAULT 0' },
      { name: 'subscribe_last_claim', type: 'TIMESTAMP' },
      { name: 'has_bot_in_bio', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'bot_in_bio_count', type: 'INTEGER DEFAULT 0' },
      { name: 'bot_in_bio_last_claim', type: 'TIMESTAMP' },
      { name: 'has_ref_in_bio', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'ref_in_bio_count', type: 'INTEGER DEFAULT 0' },
      { name: 'ref_in_bio_last_claim', type: 'TIMESTAMP' },
      { name: 'referral_last_claim', type: 'TIMESTAMP' }, // ДОБАВЛЕНО
      { name: 'referrals', type: 'INTEGER DEFAULT 0' },
      { name: 'daily_bonus_count', type: 'INTEGER DEFAULT 0' }, // ДОБАВЛЕНО
      { name: 'daily_bonus_last_claim', type: 'TIMESTAMP' }, // ДОБАВЛЕНО
      { name: 'daily_bonus_current_reward', type: 'INTEGER DEFAULT 10' }, // ДОБАВЛЕНО
      { name: 'cases_opened', type: 'INTEGER DEFAULT 0' }, // ДОБАВЛЕНО
      { name: 'level', type: 'INTEGER DEFAULT 1' } // ДОБАВЛЕНО
    ];
    
    for (const column of columnsToAdd) {
      try {
        await pool.query(`
          ALTER TABLE user_data 
          ADD COLUMN IF NOT EXISTS ${column.name} ${column.type}
        `);
        console.log(`✅ Колонка ${column.name} добавлена`);
      } catch (err) {
        console.log(`ℹ️ Колонка ${column.name} уже существует`);
      }
    }
    
  } catch (err) {
    console.error('❌ Ошибка обновления структуры:', err);
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

// 🔧 ОБНОВИТЬ СТАТУС ПОДПИСКИ ПОЛЬЗОВАТЕЛЯ
async function updateUserSubscriptionStatus(userId, isSubscribed) {
  try {
    const result = await pool.query(
      `UPDATE user_data 
       SET is_subscribed = $1, updated_at = NOW() 
       WHERE user_id = $2
       RETURNING *`,
      [isSubscribed, userId]
    );
    
    if (result.rows.length === 0) {
      // Создаем запись если её нет
      await pool.query(
        `INSERT INTO user_data (user_id, is_subscribed) 
         VALUES ($1, $2)`,
        [userId, isSubscribed]
      );
    }
    
    console.log(`✅ Статус подписки обновлен: ${userId} -> ${isSubscribed}`);
    return true;
    
  } catch (err) {
    console.error('❌ Ошибка обновления статуса подписки:', err);
    return false;
  }
}

// 🔧 ОБНОВИТЬ СТАТУС БОТА В БИО
async function updateUserBotInBioStatus(userId, hasBotInBio) {
  try {
    const result = await pool.query(
      `UPDATE user_data 
       SET has_bot_in_bio = $1, updated_at = NOW() 
       WHERE user_id = $2
       RETURNING *`,
      [hasBotInBio, userId]
    );
    
    if (result.rows.length === 0) {
      await pool.query(
        `INSERT INTO user_data (user_id, has_bot_in_bio) 
         VALUES ($1, $2)`,
        [userId, hasBotInBio]
      );
    }
    
    console.log(`✅ Статус бота в био обновлен: ${userId} -> ${hasBotInBio}`);
    return true;
    
  } catch (err) {
    console.error('❌ Ошибка обновления статуса бота в био:', err);
    return false;
  }
}

// 🔧 ОБНОВИТЬ СТАТУС РЕФ ССЫЛКИ В БИО
async function updateUserRefInBioStatus(userId, hasRefInBio) {
  try {
    const result = await pool.query(
      `UPDATE user_data 
       SET has_ref_in_bio = $1, updated_at = NOW() 
       WHERE user_id = $2
       RETURNING *`,
      [hasRefInBio, userId]
    );
    
    if (result.rows.length === 0) {
      await pool.query(
        `INSERT INTO user_data (user_id, has_ref_in_bio) 
         VALUES ($1, $2)`,
        [userId, hasRefInBio]
      );
    }
    
    console.log(`✅ Статус реф ссылки в био обновлен: ${userId} -> ${hasRefInBio}`);
    return true;
    
  } catch (err) {
    console.error('❌ Ошибка обновления статуса реф ссылки в био:', err);
    return false;
  }
}

// 🔧 ЗАБРАТЬ НАГРАДУ ЗА ПОДПИСКУ
async function claimSubscribeReward(userId) {
  try {
    const userDataResult = await pool.query(
      'SELECT * FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    if (userDataResult.rows.length === 0) {
      return { success: false, error: 'User data not found' };
    }
    
    const userData = userDataResult.rows[0];
    const now = new Date();
    const lastClaim = userData.subscribe_last_claim;
    const cooldown = 60 * 1000; // 1 минута
    
    // Проверяем кулдаун
    if (lastClaim && (now - new Date(lastClaim)) < cooldown) {
      const remaining = cooldown - (now - new Date(lastClaim));
      return { 
        success: false, 
        error: 'Cooldown', 
        remaining: Math.ceil(remaining / 1000) 
      };
    }
    
    // Проверяем подписку
    if (!userData.is_subscribed) {
      return { success: false, error: 'Not subscribed' };
    }
    
    // Начисляем награду
    const reward = 100;
    const newBalance = (userData.balance || 0) + reward;
    const newCount = (userData.subscribe_count || 0) + 1;
    
    // Обновляем баланс и счетчик
    await pool.query(
      `UPDATE user_data 
       SET balance = $1, subscribe_count = $2, subscribe_last_claim = $3, updated_at = NOW()
       WHERE user_id = $4`,
      [newBalance, newCount, now, userId]
    );
    
    // Обновляем баланс в основной таблице
    await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2',
      [newBalance, userId]
    );
    
    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, description) 
       VALUES ($1, $2, $3, $4)`,
      [userId, reward, 'subscribe', 'Награда за подписку на канал']
    );
    
    console.log(`✅ Награда за подписку начислена: ${userId} -> +${reward} монет`);
    return { success: true, reward: reward, newBalance: newBalance };
    
  } catch (err) {
    console.error('❌ Ошибка начисления награды за подписку:', err);
    return { success: false, error: 'Server error' };
  }
}

// 🔧 ЗАБРАТЬ НАГРАДУ ЗА БОТА В БИО
async function claimBotInBioReward(userId) {
  try {
    const userDataResult = await pool.query(
      'SELECT * FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    if (userDataResult.rows.length === 0) {
      return { success: false, error: 'User data not found' };
    }
    
    const userData = userDataResult.rows[0];
    const now = new Date();
    const lastClaim = userData.bot_in_bio_last_claim;
    const cooldown = 60 * 1000; // 1 минута
    
    // Проверяем кулдаун
    if (lastClaim && (now - new Date(lastClaim)) < cooldown) {
      const remaining = cooldown - (now - new Date(lastClaim));
      return { 
        success: false, 
        error: 'Cooldown', 
        remaining: Math.ceil(remaining / 1000) 
      };
    }
    
    // Проверяем наличие бота в био
    if (!userData.has_bot_in_bio) {
      return { success: false, error: 'Bot not in bio' };
    }
    
    // Начисляем награду
    const reward = 50;
    const newBalance = (userData.balance || 0) + reward;
    const newCount = (userData.bot_in_bio_count || 0) + 1;
    
    // Обновляем баланс и счетчик
    await pool.query(
      `UPDATE user_data 
       SET balance = $1, bot_in_bio_count = $2, bot_in_bio_last_claim = $3, updated_at = NOW()
       WHERE user_id = $4`,
      [newBalance, newCount, now, userId]
    );
    
    // Обновляем баланс в основной таблице
    await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2',
      [newBalance, userId]
    );
    
    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, description) 
       VALUES ($1, $2, $3, $4)`,
      [userId, reward, 'bot_in_bio', 'Награда за бота в фамилии']
    );
    
    console.log(`✅ Награда за бота в био начислена: ${userId} -> +${reward} монет`);
    return { success: true, reward: reward, newBalance: newBalance };
    
  } catch (err) {
    console.error('❌ Ошибка начисления награды за бота в био:', err);
    return { success: false, error: 'Server error' };
  }
}

// 🔧 ЗАБРАТЬ НАГРАДУ ЗА РЕФ ССЫЛКУ В БИО
async function claimRefInBioReward(userId) {
  try {
    const userDataResult = await pool.query(
      'SELECT * FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    if (userDataResult.rows.length === 0) {
      return { success: false, error: 'User data not found' };
    }
    
    const userData = userDataResult.rows[0];
    const now = new Date();
    const lastClaim = userData.ref_in_bio_last_claim;
    const cooldown = 60 * 1000; // 1 минута
    
    // Проверяем кулдаун
    if (lastClaim && (now - new Date(lastClaim)) < cooldown) {
      const remaining = cooldown - (now - new Date(lastClaim));
      return { 
        success: false, 
        error: 'Cooldown', 
        remaining: Math.ceil(remaining / 1000) 
      };
    }
    
    // Проверяем наличие реф ссылки в био
    if (!userData.has_ref_in_bio) {
      return { success: false, error: 'Ref link not in bio' };
    }
    
    // Начисляем награду
    const reward = 20;
    const newBalance = (userData.balance || 0) + reward;
    const newCount = (userData.ref_in_bio_count || 0) + 1;
    
    // Обновляем баланс и счетчик
    await pool.query(
      `UPDATE user_data 
       SET balance = $1, ref_in_bio_count = $2, ref_in_bio_last_claim = $3, updated_at = NOW()
       WHERE user_id = $4`,
      [newBalance, newCount, now, userId]
    );
    
    // Обновляем баланс в основной таблице
    await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2',
      [newBalance, userId]
    );
    
    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, description) 
       VALUES ($1, $2, $3, $4)`,
      [userId, reward, 'ref_in_bio', 'Награда за реф ссылку в описании']
    );
    
    console.log(`✅ Награда за реф ссылку в био начислена: ${userId} -> +${reward} монет`);
    return { success: true, reward: reward, newBalance: newBalance };
    
  } catch (err) {
    console.error('❌ Ошибка начисления награды за реф ссылку в био:', err);
    return { success: false, error: 'Server error' };
  }
}

// 📡 МАРШРУТЫ API

// Главная страница API
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API работает!', 
    database: 'PostgreSQL на Railway',
    timestamp: new Date().toISOString()
  });
});

// 🔧 ПОЛУЧИТЬ ПОЛНЫЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
app.get('/api/user/full/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Получаем основные данные пользователя
    const userResult = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Получаем дополнительные данные
    const dataResult = await pool.query(
      'SELECT * FROM user_data WHERE user_id = $1',
      [userId]
    );
    
    let userData = {
      balance: user.balance || 0,
      // Подписка на канал
      is_subscribed: false,
      subscribe_count: 0,
      subscribe_last_claim: null,
      // Бот в био
      has_bot_in_bio: false,
      bot_in_bio_count: 0,
      bot_in_bio_last_claim: null,
      // Реф ссылка в био
      has_ref_in_bio: false,
      ref_in_bio_count: 0,
      ref_in_bio_last_claim: null,
      // Ежедневный бонус
      daily_bonus: {
        count: 0,
        last_claim: null,
        current_reward: 10
      },
      referrals: 0,
      cases_opened: 0,
      inventory: [],
      level: 1
    };
    
    if (dataResult.rows.length > 0) {
      const data = dataResult.rows[0];
      userData = {
        balance: data.balance || user.balance || 0,
        // Подписка на канал
        is_subscribed: data.is_subscribed || false,
        subscribe_count: data.subscribe_count || 0,
        subscribe_last_claim: data.subscribe_last_claim,
        // Бот в био
        has_bot_in_bio: data.has_bot_in_bio || false,
        bot_in_bio_count: data.bot_in_bio_count || 0,
        bot_in_bio_last_claim: data.bot_in_bio_last_claim,
        // Реф ссылка в био
        has_ref_in_bio: data.has_ref_in_bio || false,
        ref_in_bio_count: data.ref_in_bio_count || 0,
        ref_in_bio_last_claim: data.ref_in_bio_last_claim,
        // Ежедневный бонус
        daily_bonus: {
          count: data.daily_bonus_count || 0,
          last_claim: data.daily_bonus_last_claim,
          current_reward: data.daily_bonus_current_reward || 10
        },
        referrals: data.referrals || 0,
        referral_last_claim: data.referral_last_claim,
        cases_opened: data.cases_opened || 0,
        level: data.level || 1,
        inventory: []
      };
    } else {
      // Создаем запись в user_data если её нет
      await pool.query(
        `INSERT INTO user_data (user_id, balance) VALUES ($1, $2)`,
        [userId, user.balance || 0]
      );
    }
    
    // Получаем инвентарь
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

// 🔧 ОБНОВИТЬ СТАТУС ПОДПИСКИ
app.post('/api/user/:userId/subscription', async (req, res) => {
  try {
    const { userId } = req.params;
    const { is_subscribed } = req.body;
    
    const result = await updateUserSubscriptionStatus(userId, is_subscribed);
    
    if (result) {
      res.json({ success: true, is_subscribed: is_subscribed });
    } else {
      res.status(500).json({ error: 'Failed to update subscription status' });
    }
  } catch (err) {
    console.error('Error updating subscription status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ОБНОВИТЬ СТАТУС БОТА В БИО
app.post('/api/user/:userId/bot-in-bio', async (req, res) => {
  try {
    const { userId } = req.params;
    const { has_bot_in_bio } = req.body;
    
    const result = await updateUserBotInBioStatus(userId, has_bot_in_bio);
    
    if (result) {
      res.json({ success: true, has_bot_in_bio: has_bot_in_bio });
    } else {
      res.status(500).json({ error: 'Failed to update bot in bio status' });
    }
  } catch (err) {
    console.error('Error updating bot in bio status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ОБНОВИТЬ СТАТУС РЕФ ССЫЛКИ В БИО
app.post('/api/user/:userId/ref-in-bio', async (req, res) => {
  try {
    const { userId } = req.params;
    const { has_ref_in_bio } = req.body;
    
    const result = await updateUserRefInBioStatus(userId, has_ref_in_bio);
    
    if (result) {
      res.json({ success: true, has_ref_in_bio: has_ref_in_bio });
    } else {
      res.status(500).json({ error: 'Failed to update ref in bio status' });
    }
  } catch (err) {
    console.error('Error updating ref in bio status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ЗАБРАТЬ НАГРАДУ ЗА ПОДПИСКУ
app.post('/api/user/:userId/claim-subscribe', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await claimSubscribeReward(userId);
    res.json(result);
  } catch (err) {
    console.error('Error claiming subscribe reward:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 🔧 ЗАБРАТЬ НАГРАДУ ЗА БОТА В БИО
app.post('/api/user/:userId/claim-bot-in-bio', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await claimBotInBioReward(userId);
    res.json(result);
  } catch (err) {
    console.error('Error claiming bot in bio reward:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 🔧 ЗАБРАТЬ НАГРАДУ ЗА РЕФ ССЫЛКУ В БИО
app.post('/api/user/:userId/claim-ref-in-bio', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await claimRefInBioReward(userId);
    res.json(result);
  } catch (err) {
    console.error('Error claiming ref in bio reward:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// 🔧 СОХРАНИТЬ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
app.post('/api/user/data/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userData = req.body;
    
    const result = await pool.query(
      `INSERT INTO user_data (
        user_id, balance, is_subscribed, subscribe_count, subscribe_last_claim,
        has_bot_in_bio, bot_in_bio_count, bot_in_bio_last_claim,
        has_ref_in_bio, ref_in_bio_count, ref_in_bio_last_claim,
        daily_bonus_count, daily_bonus_last_claim, daily_bonus_current_reward,
        referral_last_claim, cases_opened, level, referrals
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        balance = $2,
        is_subscribed = $3,
        subscribe_count = $4,
        subscribe_last_claim = $5,
        has_bot_in_bio = $6,
        bot_in_bio_count = $7,
        bot_in_bio_last_claim = $8,
        has_ref_in_bio = $9,
        ref_in_bio_count = $10,
        ref_in_bio_last_claim = $11,
        daily_bonus_count = $12,
        daily_bonus_last_claim = $13,
        daily_bonus_current_reward = $14,
        referral_last_claim = $15,
        cases_opened = $16,
        level = $17,
        referrals = $18,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        userData.balance || 0,
        userData.is_subscribed || false,
        userData.subscribe_count || 0,
        userData.subscribe_last_claim,
        userData.has_bot_in_bio || false,
        userData.bot_in_bio_count || 0,
        userData.bot_in_bio_last_claim,
        userData.has_ref_in_bio || false,
        userData.ref_in_bio_count || 0,
        userData.ref_in_bio_last_claim,
        userData.daily_bonus?.count || 0,
        userData.daily_bonus?.last_claim,
        userData.daily_bonus?.current_reward || 10,
        userData.referral_last_claim,
        userData.cases_opened || 0,
        userData.level || 1,
        userData.referrals || 0
      ]
    );
    
    // Также обновляем баланс в основной таблице users
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

// ... остальные существующие endpoints остаются без изменений ...

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
    await createTables();
    console.log('✅ Все таблицы готовы!');
    
    // Проверяем подключение
    const testResult = await pool.query('SELECT NOW() as time');
    console.log('✅ Подключение к базе:', testResult.rows[0].time);
    
    console.log('📡 Новые endpoints для заданий:');
    console.log('   POST /api/user/:userId/subscription');
    console.log('   POST /api/user/:userId/bot-in-bio');
    console.log('   POST /api/user/:userId/ref-in-bio');
    console.log('   POST /api/user/:userId/claim-subscribe');
    console.log('   POST /api/user/:userId/claim-bot-in-bio');
    console.log('   POST /api/user/:userId/claim-ref-in-bio');
    
  } catch (err) {
    console.error('❌ Ошибка инициализации:', err);
  }
});

