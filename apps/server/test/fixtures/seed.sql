-- Synthetic sample database for end-to-end tests. Contains no real data.
CREATE TABLE dbo.Customers (
  CustomerId int IDENTITY PRIMARY KEY,
  FullName nvarchar(100) NOT NULL,
  Country char(2) NOT NULL
);
CREATE TABLE dbo.Products (
  ProductId int IDENTITY PRIMARY KEY,
  ProductName nvarchar(100) NOT NULL,
  UnitPrice decimal(10,2) NOT NULL
);
CREATE TABLE dbo.Orders (
  OrderId int IDENTITY PRIMARY KEY,
  CustomerId int NOT NULL REFERENCES dbo.Customers(CustomerId),
  OrderDate date NOT NULL
);
CREATE TABLE dbo.OrderLines (
  OrderLineId int IDENTITY PRIMARY KEY,
  OrderId int NOT NULL REFERENCES dbo.Orders(OrderId),
  ProductId int NOT NULL REFERENCES dbo.Products(ProductId),
  Quantity int NOT NULL
);
EXEC sys.sp_addextendedproperty 'MS_Description', 'Every sellable item', 'SCHEMA', 'dbo', 'TABLE', 'Products';

INSERT dbo.Customers (FullName, Country)
SELECT CONCAT('Customer ', n), CHOOSE(n % 3 + 1, 'PK', 'AE', 'GB')
FROM (SELECT TOP (30) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects) x;

INSERT dbo.Products (ProductName, UnitPrice) VALUES
  ('Widget', 10.00), ('Gadget', 25.50), ('Gizmo', 99.99), ('Doohickey', 5.25), ('Thingamajig', 42.00);

INSERT dbo.Orders (CustomerId, OrderDate)
SELECT n % 30 + 1, DATEADD(day, n, '2025-01-01')
FROM (SELECT TOP (500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects) x;

INSERT dbo.OrderLines (OrderId, ProductId, Quantity)
SELECT o.OrderId, (o.OrderId + k) % 5 + 1, (o.OrderId * k) % 7 + 1
FROM dbo.Orders o CROSS JOIN (VALUES (1), (2), (3)) v(k);
