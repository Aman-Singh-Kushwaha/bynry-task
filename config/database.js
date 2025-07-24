import { Sequelize } from 'sequelize';

// We are using an in-memory SQLite database for this example.
// It's easy to set up and requires no external database server.
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'db.sqlite',
  logging: false,
});

export default sequelize;