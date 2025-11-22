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

// В index.js в функции createAdditionalTables() добавляем недостающие колонки
async function createAdditionalTables() {
  try {
    // Таблица для данных пользователя с отдельными колонками для времени
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
    console.log('✅ Таблица user_data создана/обновлена');
    
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
      { name: 'referral_last_claim', type: 'TIMESTAMP' },
      { name: 'referrals', type: 'INTEGER DEFAULT 0' }
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

    // Обновляем счетчик рефералов в user_data
    await pool.query(
      `UPDATE user_data 
       SET referrals = COALESCE(referrals, 0) + 1 
       WHERE user_id = $1`,
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
      'GET /api/user/full/:userId',
      'POST /api/user',
      'GET /api/users',
      'GET /api/messages',
      'POST /api/messages',
      'PUT /api/user/:userId/balance',
      'PUT /api/user/:userId',
      'POST /api/user/data/:userId',
      'POST /api/user/inventory/:userId',
      'POST /api/user/quest-cooldown/:userId',
      'POST /api/check-subscription/:userId',
      'POST /api/check-bio/:userId',
      'GET /api/cases',
      'GET /api/raffles'
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

// 🔧 ПОЛУЧИТЬ ПОЛНЫЕ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ С ФОТО И ИНВЕНТАРЕМ
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
      daily_bonus: {
        count: 0,
        last_claim: null,
        current_reward: 10
      },
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
    } else {
      // Создаем запись в user_data если её нет
      await pool.query(
        `INSERT INTO user_data (user_id, balance, referrals) VALUES ($1, $2, $3)`,
        [userId, user.balance || 0, user.referral_count || 0]
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

// 🔧 ДОБАВИТЬ ПРЕДМЕТ В ИНВЕНТАРЬ
app.post('/api/user/inventory/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, price, image } = req.body;
    
    const result = await pool.query(
      `INSERT INTO user_inventory (user_id, item_name, item_price, item_image)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, name, price, image]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error adding to inventory:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ОБНОВИТЬ ВРЕМЯ ПОСЛЕДНЕЙ НАГРАДЫ
app.post('/api/user/quest-cooldown/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { questType } = req.body;
    
    const now = new Date().toISOString();
    
    // Обновляем время последней награды для конкретного квеста
    let updateField = '';
    switch(questType) {
      case 'daily':
        updateField = 'daily_bonus_last_claim';
        break;
      case 'subscribe':
        updateField = 'subscribe_last_claim';
        break;
      case 'name':
        updateField = 'name_last_claim';
        break;
      case 'ref_desc':
        updateField = 'ref_desc_last_claim';
        break;
      case 'referral':
        updateField = 'referral_last_claim';
        break;
    }
    
    if (updateField) {
      await pool.query(
        `UPDATE user_data SET ${updateField} = $1 WHERE user_id = $2`,
        [now, userId]
      );
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating quest cooldown:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПРОВЕРКА ПОДПИСКИ НА КАНАЛ
app.post('/api/check-subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Эмуляция проверки подписки (заменить на реальный Telegram API вызов)
    const isSubscribed = await checkTelegramSubscription(userId);
    
    res.json({ 
      subscribed: isSubscribed,
      channel: TELEGRAM_CHANNEL
    });
  } catch (err) {
    console.error('Error checking subscription:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПРОВЕРКА ИМЕНИ БОТА В ФАМИЛИИ
app.post('/api/check-bio/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Получаем данные пользователя из базы
    const userResult = await pool.query(
      'SELECT last_name FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.json({ hasBotInBio: false });
    }
    
    const user = userResult.rows[0];
    const hasBotInBio = user.last_name && user.last_name.includes('@CS2DropZone_bot');
    
    res.json({ hasBotInBio: hasBotInBio });
  } catch (err) {
    console.error('Error checking bio:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ЭМУЛЯЦИЯ ПРОВЕРКИ ПОДПИСКИ (ЗАМЕНИТЬ НА РЕАЛЬНЫЙ TELEGRAM API)
async function checkTelegramSubscription(userId) {
  try {
    // Реальная реализация:
    // const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${TELEGRAM_CHANNEL}&user_id=${userId}`);
    // const data = await response.json();
    // return data.ok && data.result && data.result.status !== 'left';
    
    // Временная эмуляция
    console.log(`🔍 Проверка подписки пользователя ${userId} на канал ${TELEGRAM_CHANNEL}`);
    return Math.random() > 0.3; // 70% шанс что подписан
  } catch (error) {
    console.error('Telegram API error:', error);
    return false;
  }
}

// 🔧 ПОЛУЧИТЬ КЕЙСЫ
app.get('/api/cases', async (req, res) => {
  try {
    // Временные тестовые данные
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
      },
      {
        id: 2,
        name: "Кейс Lurk",
        price: 200,
        image: "https://cs-shot.pro/images/new2/Lurk.png",
        total_opened: 892,
        items: [
          { name: "M4A4 | Howl", price: "8000", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLkjYbf7itX6vytbbZSKOmsHGKU1edxtfNWQyC0nQlptWWEzd-qd3mVbgR2WZYiFuUMtUG7x4HhYeLhs1fZiN1DnC6viH4Y7TErvbgp6HjWjQ" },
          { name: "Knife | Fade", price: "12000", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwi5Hf_jdk4OSrerRsM-OsCXWRx9F3peZWRyyygwRp527cn478dXyXbAJ2DZV2QucK5BDukoexMO3m4QWN2o1Hyiz-ii4bvTErvbhWWiFhog" }
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
    // Временные тестовые данные
    const testRaffles = [
      { 
        id: 1, 
        name: 'AK-47 | Годовая подписка', 
        end_date: '2024-12-31T23:59:59', 
        participants: 1245,
        image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSIf6GDG6D_uJ_t-l9AX_nzBhw4TvWwo6udC2QbgZyWcN2RuMP4xHrlYDnYezm7geP3d5FyH3gznQeY_Oe4QY'
      },
      { 
        id: 2, 
        name: 'AWP | Элитный кейс', 
        end_date: '2024-12-25T23:59:59', 
        participants: 893,
        image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwiFO0P_6afBSJeaaAliUwOd7qe5WQyC0nQlp4GqGz42ucCqXaQMhDpd4R-AIsxK6ktXgZePltVPXitoRn3-tjCgd6zErvbijVJZd2Q'
      }
    ];
    
    res.json(testRaffles);
  } catch (err) {
    console.error('Error getting raffles:', err);
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

// 🔧 ОБНОВИТЬ БАЛАНС ПОЛЬЗОВАТЕЛЯ
app.put('/api/user/:userId/balance', async (req, res) => {
  try {
    const { userId } = req.params;
    const { balance } = req.body;
    
    if (balance === undefined) {
      return res.status(400).json({ error: 'Balance is required' });
    }

    // Обновляем баланс в основной таблице
    const result = await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2 RETURNING *',
      [balance, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Обновляем баланс в user_data
    await pool.query(
      'UPDATE user_data SET balance = $1 WHERE user_id = $2',
      [balance, userId]
    );

    // Записываем транзакцию
    await pool.query(
      `INSERT INTO transactions (user_id, amount, type, description) 
       VALUES ($1, $2, $3, $4)`,
      [userId, balance, 'game', 'Обновление баланса из игры']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Ошибка обновления баланса:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ОБНОВИТЬ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
app.put('/api/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, first_name, last_name, photo_url } = req.body;
    
    const result = await pool.query(
      `UPDATE users 
       SET username = COALESCE($1, username),
           first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           photo_url = COALESCE($4, photo_url),
           updated_at = NOW()
       WHERE user_id = $5 
       RETURNING *`,
      [username, first_name, last_name, photo_url, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Ошибка обновления пользователя:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.*, COUNT(r.id) as referral_count
      FROM users u
      LEFT JOIN referrals r ON u.user_id = r.referrer_id
      GROUP BY u.id
      ORDER BY u.balance DESC
      LIMIT 100
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
    
    console.log('📡 Доступные endpoints:');
    console.log('   GET  /');
    console.log('   GET  /health');
    console.log('   GET  /api/user/:userId');
    console.log('   GET  /api/user/full/:userId');
    console.log('   POST /api/user');
    console.log('   GET  /api/users');
    console.log('   GET  /api/messages');
    console.log('   POST /api/messages');
    console.log('   PUT  /api/user/:userId/balance');
    console.log('   PUT  /api/user/:userId');
    console.log('   POST /api/user/data/:userId');
    console.log('   POST /api/user/inventory/:userId');
    console.log('   POST /api/user/quest-cooldown/:userId');
    console.log('   POST /api/check-subscription/:userId');
    console.log('   POST /api/check-bio/:userId');
    console.log('   GET  /api/cases');
    console.log('   GET  /api/raffles');
    
  } catch (err) {
    console.error('❌ Ошибка инициализации:', err);
  }
});

