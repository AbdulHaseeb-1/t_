-- Eval_Retail: deterministic synthetic retail database for accuracy evaluation.
-- No real data. Same input => same rows on every SQL Server, every run.
EXEC('CREATE SCHEMA sales');
EXEC('CREATE SCHEMA catalog');
EXEC('CREATE SCHEMA hr');

CREATE TABLE sales.Regions (
  RegionId int PRIMARY KEY,
  RegionName varchar(20) NOT NULL
);
INSERT sales.Regions VALUES (1, 'North'), (2, 'South'), (3, 'East'), (4, 'West');

CREATE TABLE hr.Employees (
  EmployeeId int PRIMARY KEY,
  FullName nvarchar(80) NOT NULL,
  Title varchar(30) NOT NULL,
  ManagerId int NULL REFERENCES hr.Employees(EmployeeId),
  RegionId int NULL REFERENCES sales.Regions(RegionId),
  HireDate date NOT NULL
);
INSERT hr.Employees VALUES (1, N'Amina Qureshi', 'CEO', NULL, NULL, '2015-03-01');
INSERT hr.Employees
SELECT 1 + r, CONCAT(N'Manager ', RegionName), 'Regional Manager', 1, r, DATEADD(month, r * 7, '2016-01-15')
FROM (SELECT RegionId AS r, RegionName FROM sales.Regions) x;
INSERT hr.Employees
SELECT 5 + i,
  CONCAT(CHOOSE(i % 10 + 1, N'Ali', N'Sara', N'Omar', N'Hina', N'Bilal', N'Zara', N'Usman', N'Maryam', N'Hamza', N'Ayesha'), N' ',
         CHOOSE(i % 7 + 1, N'Khan', N'Ahmed', N'Malik', N'Butt', N'Sheikh', N'Raza', N'Iqbal')),
  'Sales Rep', 2 + (i % 4), 1 + (i % 4), DATEADD(day, i * 97, '2018-06-01')
FROM (SELECT TOP (20) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects) n;

CREATE TABLE sales.Customers (
  CustomerId int PRIMARY KEY,
  FirstName nvarchar(40) NOT NULL,
  LastName nvarchar(40) NOT NULL,
  Email varchar(100) NOT NULL,
  CountryCode char(2) NOT NULL,
  City varchar(30) NOT NULL,
  Segment varchar(20) NOT NULL,
  RegionId int NOT NULL REFERENCES sales.Regions(RegionId),
  SignupDate date NOT NULL,
  IsActive bit NOT NULL,
  ReferredByCustomerId int NULL REFERENCES sales.Customers(CustomerId)
);
WITH n AS (SELECT TOP (400) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b),
c AS (SELECT i, CHOOSE(i % 7 + 1, 'PK', 'PK', 'AE', 'GB', 'US', 'US', 'DE') AS cc FROM n)
INSERT sales.Customers
SELECT i,
  CHOOSE(i % 10 + 1, N'Noor', N'Adam', N'Leah', N'Imran', N'Fatima', N'John', N'Mia', N'Hassan', N'Emma', N'Karim'),
  CHOOSE((i / 10) % 10 + 1, N'Shah', N'Smith', N'Mueller', N'Rahman', N'Jones', N'Chaudhry', N'Brown', N'Aziz', N'Fischer', N'Taylor'),
  CONCAT('customer', i, '@example.com'),
  cc,
  CASE cc WHEN 'PK' THEN IIF((i / 7) % 2 = 0, 'Lahore', 'Karachi')
          WHEN 'AE' THEN IIF((i / 7) % 2 = 0, 'Dubai', 'Abu Dhabi')
          WHEN 'GB' THEN IIF((i / 7) % 2 = 0, 'London', 'Manchester')
          WHEN 'US' THEN IIF((i / 7) % 2 = 0, 'New York', 'Austin')
          ELSE IIF((i / 7) % 2 = 0, 'Berlin', 'Munich') END,
  CHOOSE(i % 3 + 1, 'Consumer', 'Corporate', 'Small Business'),
  1 + (i % 4),
  DATEADD(day, (i * 37) % 900, '2022-06-01'),
  IIF(i % 9 = 0, 0, 1),
  IIF(i % 5 = 0 AND i > 10, 1 + (i * 3) % 11, NULL)
FROM c;

CREATE TABLE catalog.Categories (
  CategoryId int PRIMARY KEY,
  CategoryName varchar(40) NOT NULL,
  ParentCategoryId int NULL REFERENCES catalog.Categories(CategoryId)
);
INSERT catalog.Categories VALUES
  (1, 'Electronics', NULL), (2, 'Home', NULL), (3, 'Clothing', NULL),
  (4, 'Phones', 1), (5, 'Laptops', 1), (6, 'Audio', 1),
  (7, 'Kitchen', 2), (8, 'Furniture', 2),
  (9, 'Men', 3), (10, 'Women', 3), (11, 'Kids', 3);

CREATE TABLE catalog.Products (
  ProductId int PRIMARY KEY,
  ProductName nvarchar(60) NOT NULL,
  CategoryId int NOT NULL REFERENCES catalog.Categories(CategoryId),
  UnitPrice decimal(10, 2) NOT NULL,
  UnitCost decimal(10, 2) NOT NULL,
  IsDiscontinued bit NOT NULL,
  LaunchDate date NOT NULL
);
WITH n AS (SELECT TOP (48) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects),
p AS (SELECT i, i % 8 AS k,
        CAST(CHOOSE(i % 8 + 1, 600, 1200, 150, 80, 250, 35, 60, 25) * (1 + (i % 5) * 0.1) AS decimal(10, 2)) AS price
      FROM n)
INSERT catalog.Products
SELECT i,
  CONCAT(CHOOSE(k + 1, N'Phone', N'Laptop', N'Speaker', N'Blender', N'Chair', N'Shirt', N'Dress', N'Puzzle'), N' ', CHAR(65 + (i - 1) / 8), i),
  CHOOSE(k + 1, 4, 5, 6, 7, 8, 9, 10, 11),
  price,
  CAST(price * (0.55 + (i % 3) * 0.05) AS decimal(10, 2)),
  IIF(i % 11 = 0, 1, 0),
  DATEADD(month, i % 24, '2023-01-01')
FROM p;

CREATE TABLE sales.Orders (
  OrderId int PRIMARY KEY,
  CustomerId int NOT NULL REFERENCES sales.Customers(CustomerId),
  SalesRepId int NULL REFERENCES hr.Employees(EmployeeId),
  OrderDate datetime2(0) NOT NULL,
  Status varchar(12) NOT NULL,
  Channel varchar(10) NOT NULL,
  ShippedDate date NULL
);
WITH n AS (SELECT TOP (6000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b),
o AS (
  SELECT i,
    IIF(i % 4 = 0, 1 + (i % 40), 1 + (i * 7) % 390) AS cust,
    CHOOSE(i % 10 + 1, 'Web', 'Web', 'Web', 'Web', 'Store', 'Store', 'Store', 'Phone', 'Phone', 'Web') AS ch,
    DATEADD(minute, (i * 7919) % 1440, CAST(DATEADD(day, (i * 37) % 731, '2024-01-01') AS datetime2(0))) AS dt
  FROM n),
s AS (
  SELECT *, CASE WHEN i % 23 = 0 THEN 'Cancelled' WHEN i % 29 = 0 THEN 'Returned'
                 WHEN dt >= '2025-12-20' THEN 'Pending' WHEN dt >= '2025-12-10' THEN 'Shipped' ELSE 'Delivered' END AS st
  FROM o)
INSERT sales.Orders
SELECT i, cust, IIF(ch = 'Web', NULL, 6 + (i % 20)), dt, st, ch,
  IIF(st IN ('Delivered', 'Shipped', 'Returned'), DATEADD(day, 1 + i % 5, CAST(dt AS date)), NULL)
FROM s;

CREATE TABLE sales.OrderItems (
  OrderItemId int IDENTITY PRIMARY KEY,
  OrderId int NOT NULL REFERENCES sales.Orders(OrderId),
  ProductId int NOT NULL REFERENCES catalog.Products(ProductId),
  Quantity int NOT NULL,
  UnitPrice decimal(10, 2) NOT NULL,
  DiscountPct decimal(4, 2) NOT NULL
);
INSERT sales.OrderItems (OrderId, ProductId, Quantity, UnitPrice, DiscountPct)
SELECT o.OrderId, p.ProductId, 1 + (o.OrderId + k.k) % 4, p.UnitPrice,
  CASE WHEN (o.OrderId + k.k) % 6 = 0 THEN 0.10 WHEN (o.OrderId + k.k) % 10 = 0 THEN 0.20 ELSE 0 END
FROM sales.Orders o
CROSS JOIN (VALUES (1), (2), (3)) k(k)
JOIN catalog.Products p ON p.ProductId = 1 + (o.OrderId * 7 + k.k * 11) % 44
WHERE k.k <= 1 + o.OrderId % 3;

CREATE TABLE sales.Payments (
  PaymentId int IDENTITY PRIMARY KEY,
  OrderId int NOT NULL REFERENCES sales.Orders(OrderId),
  Amount decimal(12, 2) NOT NULL,
  Method varchar(15) NOT NULL,
  PaidAt datetime2(0) NOT NULL
);
WITH t AS (
  SELECT o.OrderId, o.OrderDate, SUM(i.Quantity * i.UnitPrice * (1 - i.DiscountPct)) AS total
  FROM sales.Orders o JOIN sales.OrderItems i ON i.OrderId = o.OrderId
  WHERE o.Status NOT IN ('Cancelled', 'Pending')
  GROUP BY o.OrderId, o.OrderDate)
INSERT sales.Payments (OrderId, Amount, Method, PaidAt)
SELECT OrderId, CAST(IIF(OrderId % 17 = 0, total / 2, total) AS decimal(12, 2)),
  CHOOSE(OrderId % 4 + 1, 'Card', 'Cash', 'Wallet', 'BankTransfer'), DATEADD(hour, 2, OrderDate)
FROM t
UNION ALL
SELECT OrderId, CAST(total - CAST(total / 2 AS decimal(12, 2)) AS decimal(12, 2)), 'Card', DATEADD(day, 3, OrderDate)
FROM t WHERE OrderId % 17 = 0;

EXEC('CREATE VIEW sales.vOrderRevenue AS
SELECT o.OrderId, o.OrderDate, o.CustomerId, o.Channel, o.Status,
       SUM(i.Quantity * i.UnitPrice * (1 - i.DiscountPct)) AS NetRevenue
FROM sales.Orders o JOIN sales.OrderItems i ON i.OrderId = o.OrderId
GROUP BY o.OrderId, o.OrderDate, o.CustomerId, o.Channel, o.Status');

EXEC sys.sp_addextendedproperty 'MS_Description', 'One row per customer order', 'SCHEMA', 'sales', 'TABLE', 'Orders';
EXEC sys.sp_addextendedproperty 'MS_Description', 'Price per unit at the time of sale', 'SCHEMA', 'sales', 'TABLE', 'OrderItems', 'COLUMN', 'UnitPrice';
EXEC sys.sp_addextendedproperty 'MS_Description', 'Discount as a fraction (0.10 = 10%)', 'SCHEMA', 'sales', 'TABLE', 'OrderItems', 'COLUMN', 'DiscountPct';
EXEC sys.sp_addextendedproperty 'MS_Description', 'Sales rep; NULL for web orders', 'SCHEMA', 'sales', 'TABLE', 'Orders', 'COLUMN', 'SalesRepId';
EXEC sys.sp_addextendedproperty 'MS_Description', 'Net revenue per order (after discounts)', 'SCHEMA', 'sales', 'VIEW', 'vOrderRevenue';
