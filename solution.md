# Part 1: Code Review and Debugging

### Problems :

1. Must perform commit in single commit operation
    - Problem: ­the code doesn’t follow atomic transactions for single operation, creating two db transaction, one(Product) after then another(inventory)
    - Impact: If one of db operation failed (say inventory commit failed) then db will have incomplete changes, causing system inconsistency in production
    - Fix: db operation should atomic – either both succeed or neither do

2. Unchecked required field
    - Problem: doesn't check for incomplete required fields or incorrect request data
    - Impact: In case of, required field missing it crashes while creating db object
    

3. No Error Handling & HTTP Status Code
    - Problem: Unhandled error and http response status code
    - Impact: Will show only 500 Internal Server Error by default, no  error detail. Also if database operation failed rollback isn't set causing unexpected changes
    - Fix: Enclose in try-catch block, and perform db rollback upon error catch

4. Unhandled condition for product,exist in multiple warehouses
    - Problem: `Product` has `warehouse_id` field which tied it to single warehouse.
    - Impact: This is business logic issue, as it wouldn't correctely handle for product stored at multiple warehouses

5. Check if existing sku, before db commit
    - Problem: since sku is user sent and unique across platform, should check its uniqueness
    - Impact: If db has UNNIQUE constraint on sku column, Insert will fail as database error


  
### Corrected Solution:
```python
@app.route('/api/products', methods=['POST'])
def create_product():
    data = request.json

    # 1. Checked required field
    required_fields = ['name', 'sku', 'price', 'warehouse_id', 'initial_quantity']
    if not data or not all(field in data for field in required_fields):
        return {"error": "Missing required fields"}, 400

    try:
        # 2. Check if existing sku, before db commit
        if Product.query.filter_by(sku=data['sku']).first():
            return {"error": f"Product with SKU '{data['sku']}' already exists"}, 409 # Conflict

        # 3. Unhandled condition for product, exist in multiple warehouses
        # The Product model should not have a warehouse_id.
        # A product's existence is independent of a warehouse.
        product = Product(
            name=data['name'],
            sku=data['sku'],
            price=data['price']
        )
        db.session.add(product)
        # Flush the session to get the generated product.id
        db.session.flush()

        inventory = Inventory(
            product_id=product.id,
            warehouse_id=data['warehouse_id'],
            quantity=data['initial_quantity']
        )
        db.session.add(inventory)

        # 4. Must perform commit in single commit operation
        db.session.commit()

        return {
            "message": "Product created",
            "product_id": product.id
        }, 201 # Created

    # 5. No Error Handling & HTTP Status Code
    except Exception as e:
        db.session.rollback()
        # For production, you would log the error `e`
        return {"error": "An unexpected error occurred"}, 500
```



# Part 2: Database Design

### Questions to Product Team:

1. Is this multi tenant system? - system for multiple companies with there seperate multiple warehouses (Assuming having multiple companies)

2. How should bundle inventory work? This one feels tricky. When a bundle is sold, do we just lower the bundle's stock count? Or should we automatically lower the stock for all the individual items inside it? Also, how would a low-stock alert work for a bundle?

3. What if a product has multiple suppliers? I set it up so a product has one main supplier, which works for the alert. But what if a business wants to see backup suppliers? We might need a more complex design for this later on.

4. How do we handle new or seasonal products? Our plan is to check the last 60 days of sales to see if a product is "active." But a brand new item will have zero sales, so it will never get an alert even if its stock is at 1. Is this okay? Same for a seasonal item that hasn't sold in a few months.

7. Are per-product thresholds enough? I put the low-stock threshold on the product. But I was thinking, maybe a business will want a different threshold for the same product in their main warehouse versus a smaller one. Is this something we need to worry about for now?

### Assumptions

- SKUs are unique per company. I assumed a SKU just needs to be unique for a single business, not across our entire platform. So, two different companies could have a product with the SKU "WID-001".

- A simple "primary supplier" is good enough for now. The design links one product to one main supplier. This makes the reorder alert simple.

- The 60-day window for "recent sales" is fixed. The logic will just look back 60 days to calculate sales activity.

- No user accounts or permissions yet. The schema doesn't include any users table, so for now, there's no concept of who is making the changes.

- Low-stock thresholds are set per product. The simplest way to handle this was to add a low_stock_threshold field directly to each product.




### 3 Database Schema 


#### `companies`

This table holds the list of businesses using StockFlow.

```sql
CREATE TABLE companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

Justification:  This is the main table that everything else will connect to using a `company_id`.

#### `suppliers` and `warehouses`

These store the supplier and warehouse info for each company.

```sql
CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name VARCHAR(255) NOT NULL,
    contact_email VARCHAR(255)
);
CREATE INDEX idx_suppliers_company_id ON suppliers(company_id);

CREATE TABLE warehouses (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name VARCHAR(255) NOT NULL,
    location TEXT
);
CREATE INDEX idx_warehouses_company_id ON warehouses(company_id);
```

Justification:  I added an index on `company_id`. I read this helps the database quickly find all the suppliers or warehouses for one company without searching the whole table.

#### `products`

This holds all the details for each product.

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    primary_supplier_id INTEGER REFERENCES suppliers(id),
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2),
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    is_bundle BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (company_id, sku)
);
CREATE INDEX idx_products_supplier_id ON products(primary_supplier_id);
```

Justification: 

  * **`UNIQUE (company_id, sku)`**: This constraint ensures a SKU is unique only within a company's list of products.
  * **`price DECIMAL`**: I used this because I’ve been told it's the right way to store money to avoid weird rounding errors.
  * **`is_bundle`**: This is a simple `true/false` flag to tell the app if it's a bundle or a regular product.

#### `inventory`

This table connects products and warehouses and stores the actual stock quantity.

```sql
CREATE TABLE inventory (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (product_id, warehouse_id)
);
```

Justification:  The key here is the composite primary key on `(product_id, warehouse_id)`. This is a neat trick to guarantee we can't add the same product to the same warehouse twice. It also makes looking up the quantity super fast.

#### `product_components`

For bundles, this table lists all the items inside.

```sql
CREATE TABLE product_components (
    bundle_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    component_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (bundle_product_id, component_product_id)
);
```

Justification:  This just creates a link between a "bundle" product and its "component" products.

#### `inventory_movement_log`

A running log of every stock change. This is essential for the sales velocity calculation, and alert notification.

```sql
CREATE TABLE inventory_movement_log (
    id BIGSERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    quantity_change INTEGER NOT NULL,
    reason VARCHAR(50) NOT NULL, -- e.g., 'sale', 'stock_in', 'transfer'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_log_query_performance ON inventory_movement_log(product_id, warehouse_id, reason, created_at);
```

Justification:  This table could get huge, so performance is key. I added a big composite index covering all the columns we'll search by for the alert query (`product_id`, `warehouse_id`, `reason`, and `created_at`).