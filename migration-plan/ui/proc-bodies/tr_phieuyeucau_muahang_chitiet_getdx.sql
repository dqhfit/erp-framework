-- PARAMS:
-- @sophieu_dexuat nvarchar

CREATE PROC [dbo].[TR_PHIEUYEUCAU_MUAHANG_CHITIET_GETDX]
(
	@sophieu_dexuat NVARCHAR (MAX) = ''
)
AS
BEGIN
	SELECT b.sophieu as sophieu_dexuat,c.mancc as nhacc, c.nhom, a.mact as mavt, a.mota, a.dvt, a.quycach,
	a.mausac, a.soluong, c.dongia, c.loaitien, (c.dongia * a.soluong) as thanhtien,
	'' as donhang, a.ghichu, GETDATE() AS ngaycangiao
	INTO #TEMP
	FROM tr_phieuyeucau_muahang_chitiet a
	INNER JOIN tr_phieuyeucau_muahang b on a.dexuat_id = b.id
	INNER JOIN tr_material c on a.mact = c.mavt
	WHERE 
		b.sophieu in (select RTRIM(LTRIM([value])) from dbo.fn_Split(@sophieu_dexuat, ',')) 
		AND a.active = 1
		AND B.active = 1 
		AND ISNULL(B.nguoiky, '') <> ''
		AND (B.IsCancel = 0 OR B.IsCancel is null)
		--AND a.id_phieuyeucau_chitiet is not null

		SELECT * FROM #TEMP
		DROP TABLE #TEMP
END


--9D M8 82
