-- PARAMS:
-- @report_id uniqueidentifier
-- @nguoiduyet nvarchar
-- @ngayduyet datetime


CREATE PROC TR_BAOCAO_FINAL_DUYET
(
	@report_id uniqueidentifier,
	@nguoiduyet nvarchar(50), 
	@ngayduyet datetime
)
AS
BEGIN
	UPDATE tr_baocao_final
	SET nguoiduyet = @nguoiduyet,
		ngayduyet = @ngayduyet
	WHERE report_id = @report_id
END

