-- PARAMS:
-- @order_id int
-- @soluong_cont float
-- @fsc_id int
-- @ncc_phoi nvarchar
-- @ncc_dinhhinh nvarchar
-- @ncc_son nvarchar
-- @target_date date
-- @actual_date date
-- @kehoach_hangtrang date
-- @status int
-- @remark2 nvarchar
-- @danhgia nvarchar
-- @trangthai_donhang nvarchar
-- @SortOrder float


CREATE PROC [dbo].[TR_ORDER_UPDATE3]
(
	@order_id int,
	@soluong_cont float,
	@fsc_id int,
	@ncc_phoi nvarchar(50),
	@ncc_dinhhinh nvarchar(50),
	@ncc_son nvarchar(50),
	@target_date date,
	@actual_date date,
	@kehoach_hangtrang date,
	@status int,
	@remark2 nvarchar(200),
	@danhgia nvarchar(200),
	@trangthai_donhang nvarchar(50),
	@SortOrder float
)
AS
BEGIN
	UPDATE tr_order
	SET cont_qty = @soluong_cont,
		fsc_id = @fsc_id,
		ncc_phoi = @ncc_phoi,
		ncc_dinhhinh = @ncc_dinhhinh,
		ncc_son = @ncc_son,
		target_date = @target_date,
		actual_date = @actual_date,
		kehoach_hangtrang = @kehoach_hangtrang,
		[status] = @status,
		remark2 = @remark2,
		trangthai_donhang = @trangthai_donhang,
		SortOrder = @SortOrder
	WHERE id = @order_id
END

