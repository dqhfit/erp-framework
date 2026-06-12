-- PARAMS:
-- @maddh nvarchar


CREATE PROC [dbo].[TR_TIEUCHUAN_BAOCAO_QC_CHONIN2](@maddh nvarchar(200))
AS
BEGIN
	SELECT B.maddh, B.donhang,
		C.c_location, C.n_location,
		CONVERT(date, A.NgayLap) AS NgayLap,
		D.UserName, D.FullName
	FROM tr_tieuchuan_baocao_qc A
		LEFT JOIN tr_dondathang B ON A.Dondathang = B.maddh
		LEFT JOIN trtb_m_location C ON A.TbMLocation = C.c_location
		LEFT JOIN SYS_USER D ON A.NguoiLap = D.UserName
	WHERE A.Dondathang = @maddh
	GROUP BY B.maddh, B.donhang, C.c_location, C.n_location, CONVERT(date, A.NgayLap), D.UserName, D.FullName
END


