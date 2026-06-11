-- PARAMS:
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
-- @fsc_100 bit
-- @fsc_cw bit
-- @fsc_mix bit
-- @fsc_recycled bit
-- @idOrderNumber int
-- @tenkhoahoc nvarchar
-- @fsc_id int

CREATE PROC [dbo].[TR_ORDER_DETAIL_INSERT2]
(
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
	@fsc_100 BIT = 0,
	@fsc_cw BIT = 0,
	@fsc_mix BIT = 0,
	@fsc_recycled BIT = 0,
	@idOrderNumber int = NULL,
	@tenkhoahoc nvarchar(max) = NULL,
	@fsc_id int = NULL
)
AS
INSERT INTO tr_order_detail
(
	customer,
	agent,
	[range],
	order_number,
	item_number,
	cust_item_number,
	[description],
	color,
	material,
	order_qty,
	cbm,
	price,
	currency,
	amount,
	bill_to,
	ship_to,
	input_qty,
	destination_port,
	etd,
	ship_date,
	ship_qty,
	order_date,
	cont_date,
	container_size,
	nccht,
	payment_term,
	remark,
	cust_po_number,
	attribute4,
	choduyet,
	f_cancelled,
	Finished,
	IsRelease,
	create_by,
	create_date,
	update_by,
	update_date,
	test_run_qty,
	fsc_100, fsc_cw, fsc_mix, fsc_recycled,
	idOrderNumber, tenkhoahoc,
	fsc_id
)
VALUES
(
	@customer,
	@agent,
	@range,
	@order_number,
	@item_number,
	@cust_item_number,
	@description,
	@color,
	@material,
	@order_qty,
	@cbm,
	@price,
	@currency,
	@amount,
	@bill_to,
	@ship_to,
	@input_qty,
	@destination_port,
	@etd,
	@ship_date,
	@ship_qty,
	@order_date,
	@cont_date,
	@container_size,
	@nccht,
	@payment_term,
	@remark,
	@cust_po_number,
	@attribute4,
	@choduyet,
	@f_cancelled,
	@Finished,
	@IsRelease,
	@create_by,
	@create_date,
	@update_by,
	@update_date,
	@test_run_qty,
	@fsc_100, @fsc_cw, @fsc_mix, @fsc_recycled,
	@idOrderNumber, @tenkhoahoc,
	@fsc_id
)
