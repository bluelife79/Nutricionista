require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.all('/api/auth', require('./api/auth'));
app.all('/api/admin', require('./api/admin'));

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ App corriendo en http://localhost:${PORT}`);
  console.log(`🔐 Panel admin en http://localhost:${PORT}/admin.html`);
});
