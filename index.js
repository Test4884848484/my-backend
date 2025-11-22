// 🔧 ОЧИСТКА БАЗЫ ДАННЫХ (ТОЛЬКО ДЛЯ РАЗРАБОТКИ!)
app.delete('/api/admin/reset-database', async (req, res) => {
  try {
    console.log('🗑️ Очистка базы данных...');
    
    // Удаляем все таблицы в правильном порядке (из-за foreign keys)
    await pool.query('DROP TABLE IF EXISTS raffle_participants CASCADE');
    await pool.query('DROP TABLE IF EXISTS raffles CASCADE');
    await pool.query('DROP TABLE IF EXISTS case_items CASCADE');
    await pool.query('DROP TABLE IF EXISTS cases CASCADE');
    await pool.query('DROP TABLE IF EXISTS user_inventory CASCADE');
    await pool.query('DROP TABLE IF EXISTS user_data CASCADE');
    await pool.query('DROP TABLE IF EXISTS messages CASCADE');
    await pool.query('DROP TABLE IF EXISTS transactions CASCADE');
    await pool.query('DROP TABLE IF EXISTS referrals CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('✅ Все таблицы удалены');
    
    // Пересоздаем таблицы
    await createTables();
    
    console.log('✅ База данных пересоздана');
    
    res.json({ 
      success: true, 
      message: 'База данных успешно очищена и пересоздана' 
    });
    
  } catch (err) {
    console.error('❌ Ошибка очистки базы данных:', err);
    res.status(500).json({ error: 'Ошибка очистки базы данных' });
  }
});

// 🔧 ОЧИСТКА ТОЛЬКО ДАННЫХ ПОЛЬЗОВАТЕЛЕЙ
app.delete('/api/admin/clear-user-data', async (req, res) => {
  try {
    console.log('🧹 Очистка данных пользователей...');
    
    // Очищаем данные но сохраняем структуру таблиц
    await pool.query('TRUNCATE TABLE user_data, user_inventory, referrals, transactions RESTART IDENTITY CASCADE');
    
    // Сбрасываем баланс пользователей
    await pool.query('UPDATE users SET balance = 0, referral_code = NULL, referred_by = NULL');
    
    console.log('✅ Данные пользователей очищены');
    
    res.json({ 
      success: true, 
      message: 'Данные пользователей успешно очищены' 
    });
    
  } catch (err) {
    console.error('❌ Ошибка очистки данных пользователей:', err);
    res.status(500).json({ error: 'Ошибка очистки данных пользователей' });
  }
});
