-- PARAMS:
-- @tongtien decimal
-- @sotien decimal OUTPUT
-- @ghichu nvarchar OUTPUT


CREATE PROC [dbo].[TINHGIA_HANGMUC_LAIVAY]
(
	@tongtien decimal(18, 2), 
	@sotien decimal(18, 2) OUT,
	@ghichu nvarchar(255) OUT
)
AS
BEGIN
	-- TỔNG CHI PHÍ CHƯA BAO GỒM LÃI VAY
	-- TỔNG CHI PHÍ * 1% * 3 tháng
	SET @sotien = @tongtien * (0.01 * 3);
	SET @ghichu = N'[Tổng chi phí (Sản xuất + Ngoài SX)] * 1% * 3 (tháng)';
END
