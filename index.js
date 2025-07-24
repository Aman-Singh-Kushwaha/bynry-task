import express, { json } from 'express';
import { sequelize } from './models.js';
import apiRoutes from './routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(json());

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.send('StockFlow API is running!');
});

const startServer = async () => {
  try {
    // Authenticate connection
    await sequelize.authenticate();
    console.log('Database connection has been established successfully.');

    // Sync all models with the database
    await sequelize.sync();
    console.log('All models were synchronized successfully.');

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Unable to connect to the database or synchronize models:', error);
  }
};

startServer();