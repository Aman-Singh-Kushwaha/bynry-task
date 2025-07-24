import { DataTypes } from 'sequelize';
import sequelize from './config/database.js';

// Define Models
const Company = sequelize.define('Company', {
  name: { type: DataTypes.STRING, allowNull: false },
});

const Warehouse = sequelize.define('Warehouse', {
  name: { type: DataTypes.STRING, allowNull: false },
  location: { type: DataTypes.TEXT },
});

const Supplier = sequelize.define('Supplier', {
  name: { type: DataTypes.STRING, allowNull: false },
  contact_email: { type: DataTypes.STRING },
});

const Product = sequelize.define('Product', {
  sku: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.DECIMAL(10, 2) },
  low_stock_threshold: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
}, {
  indexes: [{
    name: 'company_sku_unique_constraint',
    unique: true,
    fields: ['companyId', 'sku'],
  }]
});

const Inventory = sequelize.define('Inventory', {
  quantity: { type: DataTypes.INTEGER, allowNull: false },
}, { timestamps: false }); // No createdAt/updatedAt for this join table

const InventoryMovementLog = sequelize.define('InventoryMovementLog', {
  quantity_change: { type: DataTypes.INTEGER, allowNull: false },
  reason: { type: DataTypes.STRING, allowNull: false }, // 'stock_in', 'sale', etc.
}, { updatedAt: false }); // Only need createdAt

// Define Associations
Company.hasMany(Warehouse, { foreignKey: 'companyId' });
Warehouse.belongsTo(Company, { foreignKey: 'companyId' });

Company.hasMany(Supplier, { foreignKey: 'companyId' });
Supplier.belongsTo(Company, { foreignKey: 'companyId' });

Company.hasMany(Product, { foreignKey: 'companyId' });
Product.belongsTo(Company, { foreignKey: 'companyId' });

Supplier.hasMany(Product, { foreignKey: 'primarySupplierId' });
Product.belongsTo(Supplier, { as: 'primarySupplier', foreignKey: 'primarySupplierId' });

// Many-to-Many for Inventory
Product.belongsToMany(Warehouse, { through: Inventory, foreignKey: 'productId' });
Warehouse.belongsToMany(Product, { through: Inventory, foreignKey: 'warehouseId' });

Product.hasMany(Inventory, { foreignKey: 'productId' });
Inventory.belongsTo(Product, { foreignKey: 'productId' });
Warehouse.hasMany(Inventory, { foreignKey: 'warehouseId' });
Inventory.belongsTo(Warehouse, { foreignKey: 'warehouseId' });


Product.hasMany(InventoryMovementLog, { foreignKey: 'productId' });
InventoryMovementLog.belongsTo(Product, { foreignKey: 'productId' });

Warehouse.hasMany(InventoryMovementLog, { foreignKey: 'warehouseId' });
InventoryMovementLog.belongsTo(Warehouse, { foreignKey: 'warehouseId' });

export {
  sequelize,
  Company,
  Warehouse,
  Supplier,
  Product,
  Inventory,
  InventoryMovementLog,
};
