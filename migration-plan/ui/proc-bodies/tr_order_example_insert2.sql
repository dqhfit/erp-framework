-- PARAMS:
-- @order_number nvarchar
-- @customer nvarchar
-- @order_date date
-- @ship_date date
-- @etd date
-- @cont_date date
-- @f_cancelled nvarchar
-- @choduyet int
-- @IsLock bit
-- @Finished bit
-- @IsPay bit
-- @IsExample bit
-- @destination_port nvarchar
-- @ship_to nvarchar
-- @remark nvarchar
-- @payment_term nvarchar
-- @carton_marking nvarchar
-- @cont_qty decimal
-- @cust_po_number nvarchar
-- @range nvarchar
-- @create_date datetime
-- @create_by nvarchar
-- @update_date datetime
-- @update_by nvarchar
-- @ngay_hangtrang datetime
-- @ngay_son datetime
-- @ngay_donggoi datetime
-- @nguyenlieu nvarchar
-- @bemat nvarchar

CREATE PROC [dbo].[TR_ORDER_EXAMPLE_INSERT2]
(
	@order_number nvarchar(50),
	@customer nvarchar(MAX),
	@order_date date,
	@ship_date date,
	@etd date,
	@cont_date date,
	@f_cancelled nvarchar(5),
	@choduyet int,
	@IsLock bit,
	@Finished bit,
	@IsPay bit,
	@IsExample bit,
	@destination_port nvarchar(50),
	@ship_to nvarchar(50),
	@remark nvarchar(MAX),
	@payment_term nvarchar(200),
	@carton_marking nvarchar(200),
	@cont_qty decimal(18, 3),
	@cust_po_number nvarchar(200),
	@range nvarchar(200),
	@create_date datetime,
	@create_by nvarchar(50),
	@update_date datetime,
	@update_by nvarchar(50),
	@ngay_hangtrang datetime = null,
	@ngay_son datetime = null,
	@ngay_donggoi datetime = null,
	@nguyenlieu nvarchar(200) = null,
	@bemat nvarchar(200) =  null
)
AS
IF NOT EXISTS (SELECT * FROM tr_order_example WHERE order_number = @order_number)
BEGIN
  INSERT INTO tr_order_example
  (
  	order_number,
  	customer,
  	order_date,
  	ship_date,
  	etd,
  	cont_date,
  	f_cancelled,
  	choduyet,
  	IsLock,
  	Finished,
  	IsPay,
  	IsExample,
  	destination_port,
  	ship_to,
  	remark,
  	payment_term,
  	carton_marking,
  	cont_qty,
  	cust_po_number,
  	[range],
  	create_date,
  	create_by,
  	update_date,
  	update_by,
	ngay_hangtrang,
	ngay_son,
	ngay_donggoi,
	nguyenlieu,
	bemat
  )
  VALUES
  (
  	@order_number,
  	@customer,
  	@order_date,
  	@ship_date,
  	@etd,
  	@cont_date,
  	@f_cancelled,
  	@choduyet,
  	@IsLock,
  	@Finished,
  	@IsPay,
  	@IsExample,
  	@destination_port,
  	@ship_to,
  	@remark,
  	@payment_term,
  	@carton_marking,
  	@cont_qty,
  	@cust_po_number,
  	@range,
  	@create_date,
  	@create_by,
  	@update_date,
  	@update_by,
	@ngay_hangtrang,
	@ngay_son,
	@ngay_donggoi,
	@nguyenlieu,
	@bemat
  )
END
