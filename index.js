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
app.use(express.json({ limit: '10mb' }));

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

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
        photo_base64 TEXT,
        balance INTEGER DEFAULT 0,
        referral_code VARCHAR(50) UNIQUE,
        referred_by BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица users создана');

    // Таблица заданий пользователя
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_quests (
        id SERIAL PRIMARY KEY,
        user_id BIGINT UNIQUE NOT NULL,
        
        -- Подписка на канал
        subscribe_completed INTEGER DEFAULT 0,
        subscribe_last_claim TIMESTAMP,
        
        -- Бот в фамилии
        bot_in_bio_completed INTEGER DEFAULT 0,
        bot_in_bio_last_claim TIMESTAMP,
        
        -- Реф ссылка в описании
        ref_in_bio_completed INTEGER DEFAULT 0,
        ref_in_bio_last_claim TIMESTAMP,
        
        -- Ежедневный бонус
        daily_bonus_count INTEGER DEFAULT 0,
        daily_bonus_last_claim TIMESTAMP,
        daily_bonus_current_reward INTEGER DEFAULT 10,
        
        -- Рефералы
        referrals_count INTEGER DEFAULT 0,
        referral_last_claim TIMESTAMP,
        
        -- Статистика
        cases_opened INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица user_quests создана');

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

// 🔧 СОЗДАТЬ/ОБНОВИТЬ ПОЛЬЗОВАТЕЛЯ
app.post('/api/user', async (req, res) => {
  try {
    const { user_id, username, first_name, last_name, photo_url, photo_base64, referral_code } = req.body;
    
    // Проверяем существует ли пользователь
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [user_id]
    );
    
    if (existingUser.rows.length > 0) {
      // Обновляем существующего пользователя
      const updateData = [username, first_name, last_name, user_id];
      let query = `
        UPDATE users SET 
          username = $1, first_name = $2, last_name = $3, updated_at = NOW()
      `;
      
      // Добавляем фото если есть
      if (photo_url) {
        query += ', photo_url = $5';
        updateData.push(photo_url);
      }
      if (photo_base64) {
        query += ', photo_base64 = $6';
        updateData.push(photo_base64);
      }
      
      query += ' WHERE user_id = $4 RETURNING *';
      
      const result = await pool.query(query, updateData);
      
      res.json(result.rows[0]);
    } else {
      // Создаем нового пользователя
      const referralCode = referral_code || generateReferralCode();
      const result = await pool.query(
        `INSERT INTO users (user_id, username, first_name, last_name, photo_url, photo_base64, referral_code) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [user_id, username, first_name, last_name, photo_url, photo_base64, referralCode]
      );
      
      // Создаем запись в user_quests
      await pool.query(
        `INSERT INTO user_quests (user_id) VALUES ($1)`,
        [user_id]
      );
      
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('Error creating/updating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
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
    
    // Получаем данные заданий
    const questsResult = await pool.query(
      'SELECT * FROM user_quests WHERE user_id = $1',
      [userId]
    );
    
    let questsData = {
      // Подписка на канал
      subscribe_completed: 0,
      subscribe_last_claim: null,
      // Бот в био
      bot_in_bio_completed: 0,
      bot_in_bio_last_claim: null,
      // Реф ссылка в био
      ref_in_bio_completed: 0,
      ref_in_bio_last_claim: null,
      // Ежедневный бонус
      daily_bonus: {
        count: 0,
        last_claim: null,
        current_reward: 10
      },
      // Рефералы
      referrals: 0,
      referral_last_claim: null,
      // Статистика
      cases_opened: 0,
      level: 1
    };
    
    if (questsResult.rows.length > 0) {
      const quests = questsResult.rows[0];
      questsData = {
        subscribe_completed: quests.subscribe_completed || 0,
        subscribe_last_claim: quests.subscribe_last_claim,
        bot_in_bio_completed: quests.bot_in_bio_completed || 0,
        bot_in_bio_last_claim: quests.bot_in_bio_last_claim,
        ref_in_bio_completed: quests.ref_in_bio_completed || 0,
        ref_in_bio_last_claim: quests.ref_in_bio_last_claim,
        daily_bonus: {
          count: quests.daily_bonus_count || 0,
          last_claim: quests.daily_bonus_last_claim,
          current_reward: quests.daily_bonus_current_reward || 10
        },
        referrals: quests.referrals_count || 0,
        referral_last_claim: quests.referral_last_claim,
        cases_opened: quests.cases_opened || 0,
        level: quests.level || 1
      };
    }
    
    // Получаем инвентарь
    const inventoryResult = await pool.query(
      'SELECT * FROM user_inventory WHERE user_id = $1 ORDER BY obtained_at DESC',
      [userId]
    );
    
    const inventory = inventoryResult.rows.map(item => ({
      name: item.item_name,
      price: item.item_price,
      image: item.item_image
    }));
    
    res.json({
      user: user,
      quests: questsData,
      inventory: inventory
    });
    
  } catch (err) {
    console.error('Error getting full user data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ОБНОВИТЬ ВЫПОЛНЕНИЕ ЗАДАНИЯ
app.post('/api/user/:userId/complete-quest', async (req, res) => {
  try {
    const { userId } = req.params;
    const { quest_type, reward } = req.body;
    
    // Получаем текущие данные заданий
    const questsResult = await pool.query(
      'SELECT * FROM user_quests WHERE user_id = $1',
      [userId]
    );
    
    if (questsResult.rows.length === 0) {
      return res.status(404).json({ error: 'User quests not found' });
    }
    
    const quests = questsResult.rows[0];
    const now = new Date();
    
    // Определяем какое задание обновлять
    let updateField = '';
    let countField = '';
    
    switch(quest_type) {
      case 'subscribe':
        updateField = 'subscribe_last_claim';
        countField = 'subscribe_completed';
        break;
      case 'bot_in_bio':
        updateField = 'bot_in_bio_last_claim';
        countField = 'bot_in_bio_completed';
        break;
      case 'ref_in_bio':
        updateField = 'ref_in_bio_last_claim';
        countField = 'ref_in_bio_completed';
        break;
      case 'daily_bonus':
        updateField = 'daily_bonus_last_claim';
        countField = 'daily_bonus_count';
        break;
      default:
        return res.status(400).json({ error: 'Invalid quest type' });
    }
    
    // Обновляем задание
    const newCount = (quests[countField] || 0) + 1;
    
    await pool.query(
      `UPDATE user_quests 
       SET ${countField} = $1, ${updateField} = $2, updated_at = NOW()
       WHERE user_id = $3`,
      [newCount, now, userId]
    );
    
    // Начисляем награду если есть
    if (reward) {
      const userResult = await pool.query(
        'SELECT balance FROM users WHERE user_id = $1',
        [userId]
      );
      
      if (userResult.rows.length > 0) {
        const currentBalance = userResult.rows[0].balance || 0;
        const newBalance = currentBalance + reward;
        
        await pool.query(
          'UPDATE users SET balance = $1 WHERE user_id = $2',
          [newBalance, userId]
        );
        
        // Записываем транзакцию
        await pool.query(
          `INSERT INTO transactions (user_id, amount, type, description) 
           VALUES ($1, $2, $3, $4)`,
          [userId, reward, quest_type, `Награда за задание: ${quest_type}`]
        );
        
        console.log(`✅ Награда за задание начислена: ${userId} -> ${quest_type} = +${reward} монет`);
      }
    }
    
    res.json({ 
      success: true, 
      new_count: newCount,
      reward: reward 
    });
    
  } catch (err) {
    console.error('Error completing quest:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ОБНОВИТЬ БАЛАНС
app.put('/api/user/:userId/balance', async (req, res) => {
  try {
    const { userId } = req.params;
    const { balance } = req.body;
    
    await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2',
      [balance, userId]
    );
    
    res.json({ success: true, newBalance: balance });
  } catch (err) {
    console.error('Error updating balance:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 СОХРАНИТЬ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ
app.post('/api/user/data/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const userData = req.body;
    
    // Обновляем основную таблицу
    await pool.query(
      'UPDATE users SET balance = $1 WHERE user_id = $2',
      [userData.balance || 0, userId]
    );
    
    // Обновляем таблицу заданий
    await pool.query(
      `INSERT INTO user_quests (
        user_id, subscribe_completed, subscribe_last_claim,
        bot_in_bio_completed, bot_in_bio_last_claim,
        ref_in_bio_completed, ref_in_bio_last_claim,
        daily_bonus_count, daily_bonus_last_claim, daily_bonus_current_reward,
        referrals_count, referral_last_claim, cases_opened, level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        subscribe_completed = $2,
        subscribe_last_claim = $3,
        bot_in_bio_completed = $4,
        bot_in_bio_last_claim = $5,
        ref_in_bio_completed = $6,
        ref_in_bio_last_claim = $7,
        daily_bonus_count = $8,
        daily_bonus_last_claim = $9,
        daily_bonus_current_reward = $10,
        referrals_count = $11,
        referral_last_claim = $12,
        cases_opened = $13,
        level = $14,
        updated_at = NOW()`,
      [
        userId,
        userData.subscribe_completed || 0,
        userData.subscribe_last_claim,
        userData.bot_in_bio_completed || 0,
        userData.bot_in_bio_last_claim,
        userData.ref_in_bio_completed || 0,
        userData.ref_in_bio_last_claim,
        userData.daily_bonus?.count || 0,
        userData.daily_bonus?.last_claim,
        userData.daily_bonus?.current_reward || 10,
        userData.referrals || 0,
        userData.referral_last_claim,
        userData.cases_opened || 0,
        userData.level || 1
      ]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving user data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 СОХРАНИТЬ ПРЕДМЕТ В ИНВЕНТАРЬ
app.post('/api/user/:userId/inventory', async (req, res) => {
  try {
    const { userId } = req.params;
    const { item_name, item_price, item_image } = req.body;
    
    const result = await pool.query(
      `INSERT INTO user_inventory (user_id, item_name, item_price, item_image) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [userId, item_name, item_price, item_image]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error saving inventory item:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПОЛУЧИТЬ ИНВЕНТАРЬ
app.get('/api/user/:userId/inventory', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM user_inventory WHERE user_id = $1 ORDER BY obtained_at DESC',
      [userId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting inventory:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПОЛУЧИТЬ КЕЙСЫ
app.get('/api/cases', async (req, res) => {
  try {
    const casesData = [
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
    
    res.json(casesData);
  } catch (err) {
    console.error('Error getting cases:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔧 ПОЛУЧИТЬ РОЗЫГРЫШИ
app.get('/api/raffles', async (req, res) => {
  try {
    const rafflesData = [
      { 
        id: 1, 
        name: 'AK-47 | Годовая подписка', 
        end_date: '2024-12-31T23:59:59', 
        participants: 1245,
        image: 'https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlPPNSIf6GDG6D_uJ_t-l9AX_nzBhw4TvWwo6udC2QbgZyWcN2RuMP4xHrlYDnYezm7geP3d5FyH3gznQeY_Oe4QY'
      }
    ];
    
    res.json(rafflesData);
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

// Главная страница API
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 API работает!', 
    database: 'PostgreSQL',
    timestamp: new Date().toISOString()
  });
});

// 🚀 ЗАПУСК СЕРВЕРА
app.listen(port, async () => {
  console.log(`🚀 Сервер запущен на порту ${port}`);
  console.log('🔧 Инициализация базы данных...');
  
  try {
    await createTables();
    console.log('✅ Все таблицы готовы!');
    
    const testResult = await pool.query('SELECT NOW() as time');
    console.log('✅ Подключение к базе:', testResult.rows[0].time);
    
  } catch (err) {
    console.error('❌ Ошибка инициализации:', err);
  }
});
