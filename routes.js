import { Router } from 'express';
import { Op } from 'sequelize';
import { sequelize, Company, Warehouse, Supplier, Product, Inventory, InventoryMovementLog } from './models.js';

const router = Router();

// Helper function for checking required fields
const checkRequiredFields = (data, fields) => {
    return fields.every(field => data.hasOwnProperty(field));
};

// --- Creation Endpoints ---

router.post('/companies', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Missing 'name' field" });
  }
  try {
    const company = await Company.create({ name });
    res.status(201).json({ message: 'Company created', companyId: company.id });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

router.post('/companies/:companyId/warehouses', async (req, res) => {
  const { companyId } = req.params;
  const { name, location } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Missing 'name' field" });
  }
  try {
    if (!(await Company.findByPk(companyId))) {
      return res.status(404).json({ error: 'Company not found' });
    }
    const warehouse = await Warehouse.create({ name, location, companyId });
    res.status(201).json({ message: 'Warehouse created', warehouseId: warehouse.id });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

router.post('/companies/:companyId/suppliers', async (req, res) => {
  const { companyId } = req.params;
  const { name, contact_email } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Missing 'name' field" });
  }
  try {
    if (!(await Company.findByPk(companyId))) {
      return res.status(404).json({ error: 'Company not found' });
    }
    const supplier = await Supplier.create({ name, contact_email, companyId });
    res.status(201).json({ message: 'Supplier created', supplierId: supplier.id });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

router.post('/companies/:companyId/products', async (req, res) => {
    const { companyId } = req.params;
    const requiredFields = ['name', 'sku', 'price', 'warehouseId', 'initial_quantity'];

    if (!checkRequiredFields(req.body, requiredFields)) {
        return res.status(400).json({ error: `Missing required fields: ${requiredFields}` });
    }

    const t = await sequelize.transaction(); // Start a transaction

    try {
        if (!(await Company.findByPk(companyId, { transaction: t }))) {
            await t.rollback();
            return res.status(404).json({ error: 'Company not found' });
        }

        const warehouse = await Warehouse.findOne({ where: { id: req.body.warehouseId, companyId }, transaction: t });
        if (!warehouse) {
            await t.rollback();
            return res.status(404).json({ error: 'Warehouse not found or does not belong to this company' });
        }

        // Create Product
        const product = await Product.create({
            companyId: parseInt(companyId),
            name: req.body.name,
            sku: req.body.sku,
            price: req.body.price,
            primarySupplierId: req.body.primarySupplierId,
            low_stock_threshold: req.body.low_stock_threshold
        }, { transaction: t });

        // Create Initial Inventory
        await Inventory.create({
            productId: product.id,
            warehouseId: req.body.warehouseId,
            quantity: req.body.initial_quantity
        }, { transaction: t });

        // Log the initial stock-in event
        await InventoryMovementLog.create({
            productId: product.id,
            warehouseId: req.body.warehouseId,
            quantity_change: req.body.initial_quantity,
            reason: 'stock_in'
        }, { transaction: t });

        await t.commit(); // Commit the transaction
        res.status(201).json({ message: 'Product created successfully', productId: product.id });

    } catch (error) {
        await t.rollback(); // Rollback on error
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: `Product with SKU '${req.body.sku}' already exists for this company` });
        }
        res.status(500).json({ error: 'An internal error occurred' });
    }
});


// --- Low Stock Alert Endpoint ---

router.get('/companies/:companyId/alerts/low-stock', async (req, res) => {
    const { companyId } = req.params;
    try {
        if (!(await Company.findByPk(companyId))) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const sixtyDaysAgo = new Date(new Date().setDate(new Date().getDate() - 60));
        const alerts = [];

        // Step 1: Find all inventory items for the company that are at or below their threshold.
        const lowStockItems = await Inventory.findAll({
            include: [{
                model: Product,
                where: {
                    companyId,
                    // Using Op.col to compare two columns
                    low_stock_threshold: { [Op.gte]: sequelize.col('Inventory.quantity') }
                },
                include: [{ model: Supplier, as: 'primarySupplier' }]
            }, {
                model: Warehouse
            }]
        });

        // Step 2: For each low-stock item, check for recent sales activity.
        for (const item of lowStockItems) {
            const salesResult = await InventoryMovementLog.findOne({
                attributes: [[sequelize.fn('SUM', sequelize.col('quantity_change')), 'totalSales']],
                where: {
                    productId: item.productId,
                    warehouseId: item.warehouseId,
                    reason: 'sale',
                    createdAt: { [Op.gte]: sixtyDaysAgo }
                },
                raw: true
            });

            const totalSalesInPeriod = Math.abs(salesResult.totalSales || 0);
            
            if (totalSalesInPeriod > 0) {
                // Step 3: If there are sales, calculate days until stockout and build the alert.
                const avgDailySales = totalSalesInPeriod / 60.0;
                const daysUntilStockout = avgDailySales > 0 ? Math.floor(item.quantity / avgDailySales) : null;
                
                const supplierInfo = item.Product.primarySupplier ? {
                    id: item.Product.primarySupplier.id,
                    name: item.Product.primarySupplier.name,
                    contact_email: item.Product.primarySupplier.contact_email
                } : null;

                alerts.push({
                    productId: item.Product.id,
                    product_name: item.Product.name,
                    sku: item.Product.sku,
                    warehouseId: item.warehouseId,
                    warehouse_name: item.Warehouse.name,
                    current_stock: item.quantity,
                    threshold: item.Product.low_stock_threshold,
                    days_until_stockout: daysUntilStockout,
                    supplier: supplierInfo
                });
            }
        }

        res.json({
            alerts,
            total_alerts: alerts.length
        });

    } catch (error) {
        console.error(error); 
        res.status(500).json({ error: 'An internal error occurred' });
    }
});

router.post('/inventory/log', async (req, res) => {
    const { productId, warehouseId, quantity_change, reason } = req.body;
    if (!productId || !warehouseId || !quantity_change || !reason) {
        return res.status(400).json({ error: "Missing required fields: productId, warehouseId, quantity_change, reason" });
    }

    try {
        const inventoryLog = await InventoryMovementLog.create({
            productId,
            warehouseId,
            quantity_change,
            reason
        });
        res.status(201).json({ message: 'Inventory movement logged successfully', inventoryLog });
    } catch (error) {
        res.status(500).json({ error: 'An internal error occurred' });
    }
});

export default router;
