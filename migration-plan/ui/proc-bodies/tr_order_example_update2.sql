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

CREATE PROC [dbo].[TR_ORDER_EXAMPLE_UPDATE2]
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
	@bemat nvarchar(200)= null
)
AS
UPDATE tr_order_example
SET
	customer = @customer,
	order_date = @order_date,
	ship_date = @ship_date,
	etd = @etd,
	cont_date = @cont_date,
	f_cancelled = @f_cancelled,
	choduyet = @choduyet,
	IsLock = @IsLock,
	Finished = @Finished,
	IsPay = @IsPay,
	IsExample = @IsExample,
	destination_port = @destination_port,
	ship_to = @ship_to,
	remark = @remark,
	payment_term = @payment_term,
	carton_marking = @carton_marking,
	cont_qty = @cont_qty,
	cust_po_number = @cust_po_number,
	[range] = @range,
	update_date = @update_date,
	update_by = @update_by,
	ngay_hangtrang = @ngay_hangtrang,
	ngay_son = @ngay_son,
	ngay_donggoi = @ngay_donggoi,
	nguyenlieu = @nguyenlieu,
	bemat = @bemat
WHERE order_number = @order_number
