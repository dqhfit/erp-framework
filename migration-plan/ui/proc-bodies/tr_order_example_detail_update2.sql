-- PARAMS:
-- @id int
-- @customer nvarchar
-- @agent nvarchar
-- @range nvarchar
-- @order_number nvarchar
-- @item_number nvarchar
-- @cust_item_number nvarchar
-- @description nvarchar
-- @color nvarchar
-- @material nvarchar
-- @order_qty int
-- @cbm decimal
-- @price decimal
-- @currency nvarchar
-- @amount decimal
-- @bill_to nvarchar
-- @ship_to nvarchar
-- @input_qty int
-- @destination_port nvarchar
-- @etd date
-- @ship_date date
-- @ship_qty int
-- @order_date date
-- @cont_date date
-- @container_size nvarchar
-- @nccht nvarchar
-- @payment_term nvarchar
-- @remark nvarchar
-- @cust_po_number nvarchar
-- @attribute4 nvarchar
-- @choduyet nvarchar
-- @f_cancelled nvarchar
-- @Finished bit
-- @IsRelease bit
-- @create_by nvarchar
-- @create_date datetime
-- @update_by nvarchar
-- @update_date datetime
-- @test_run_qty int
-- @mact nvarchar
-- @nguyenbo bit

CREATE PROC [dbo].[TR_ORDER_EXAMPLE_DETAIL_UPDATE2]
(
	@id int,
	@customer nvarchar(100),
	@agent nvarchar(100),
	@range nvarchar(100),
	@order_number nvarchar(100),
	@item_number nvarchar(100),
	@cust_item_number nvarchar(MAX),
	@description nvarchar(MAX),
	@color nvarchar(MAX),
	@material nvarchar(MAX),
	@order_qty int,
	@cbm decimal(18, 5),
	@price decimal(18, 3),
	@currency nvarchar(50),
	@amount decimal(18, 3),
	@bill_to nvarchar(MAX),
	@ship_to nvarchar(MAX),
	@input_qty int,
	@destination_port nvarchar(50),
	@etd date,
	@ship_date date,
	@ship_qty int,
	@order_date date,
	@cont_date date,
	@container_size nvarchar(MAX),
	@nccht nvarchar(MAX),
	@payment_term nvarchar(MAX),
	@remark nvarchar(MAX),
	@cust_po_number nvarchar(MAX),
	@attribute4 nvarchar(50),
	@choduyet nvarchar(50),
	@f_cancelled nvarchar(2),
	@Finished bit,
	@IsRelease bit,
	@create_by nvarchar(50),
	@create_date datetime,
	@update_by nvarchar(50),
	@update_date datetime,
	@test_run_qty int = 0,
	@mact nvarchar(50),
	@nguyenbo bit
)
AS
DECLARE @tenct nvarchar(100) = ''
DECLARE @nguyenlieu nvarchar(100) = ''
DECLARE @quycach nvarchar(100) = ''

SELECT @tenct = tenvt, @nguyenlieu = nguyenlieu, @quycach = quycach 
FROM tr_material 
WHERE mavt = @mact

UPDATE tr_order_example_detail
SET
	customer = @customer,
	agent = @agent,
	[range] = @range,
	order_number = @order_number,
	item_number = @item_number,
	cust_item_number = @cust_item_number,
	[description] = @description,
	color = @color,
	material = @material,
	order_qty = @order_qty,
	cbm = @cbm,
	price = @price,
	currency = @currency,
	amount = @amount,
	bill_to = @bill_to,
	ship_to = @ship_to,
	input_qty = @input_qty,
	destination_port = @destination_port,
	etd = @etd,
	ship_date = @ship_date,
	ship_qty = @ship_qty,
	order_date = @order_date,
	cont_date = @cont_date,
	container_size = @container_size,
	nccht = @nccht,
	payment_term = @payment_term,
	remark = @remark,
	cust_po_number = @cust_po_number,
	attribute4 = @attribute4,
	choduyet = @choduyet,
	f_cancelled = @f_cancelled,
	Finished = @Finished,
	IsRelease = @IsRelease,
	update_by = @update_by,
	update_date = @update_date,
	test_run_qty = @test_run_qty,
	nguyenbo = @nguyenbo,
	mact = @mact,
	tenct = @tenct,
	nguyenlieu = @nguyenlieu,
	quycach = @quycach
WHERE id = @id


DECLARE @CNT INT
SET @CNT = 0

SELECT @CNT = COUNT(order_number) 
FROM tr_order_example_detail
WHERE Finished = 0
	AND f_cancelled = 'N'
	AND order_number = @order_number

IF @CNT = 0
BEGIN
	UPDATE tr_order_example
	SET Finished = 1
	WHERE order_number = @order_number
END
