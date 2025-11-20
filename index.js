// Получить данные пользователя
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

// Создать пользователя (для бота)
app.post('/api/user', async (req, res) => {
  try {
    const { user_id, username, first_name, last_name, photo_url } = req.body;
    
    const result = await pool.query(`
      INSERT INTO users (user_id, username, first_name, last_name, photo_url, referral_code)
      VALUES ($1, $2, $3, $4, $5, MD5(RANDOM()::TEXT))
      ON CONFLICT (user_id) DO UPDATE SET
        username = EXCLUDED.username,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        photo_url = EXCLUDED.photo_url
      RETURNING *
    `, [user_id, username, first_name, last_name, photo_url]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Ошибка создания пользователя:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
