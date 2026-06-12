-- PARAMS:
-- @sophieu nvarchar


CREATE PROC [dbo].[TR_DENGHI_THANHTOAN_GETBYNUMBER](@sophieu NVARCHAR(50))
AS
BEGIN
	SELECT A.*,
		nguoicanthanhtoan2 = COALESCE(B.tenncc, C.vendor_name),
		tencongty = D.TenCty
	FROM tr_denghi_thanhtoan A
		LEFT JOIN tr_phieudenghi_thanhtoan_nhacc B ON A.nguoican_thanhtoan = B.mancc
		LEFT JOIN tr_nhacc C ON A.nguoican_thanhtoan = C.vendor_id
		LEFT JOIN hr_congty D ON A.benthanhtoan = D.MaCty
	WHERE A.sophieu = @sophieu
END
