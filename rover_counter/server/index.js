const express = require('express');
const cors = require('cors');
const teamsRouter = require('./routes/teams');
const matchesRouter = require('./routes/matches');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/teams', teamsRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/admin', adminRouter);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
