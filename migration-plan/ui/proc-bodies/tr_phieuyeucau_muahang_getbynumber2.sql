-- PARAMS:
-- @sophieu nvarchar


CREATE PROC TR_PHIEUYEUCAU_MUAHANG_GETBYNUMBER2 (@sophieu nvarchar(50))
AS
BEGIN
	-- Table0: Thông tin phiếu đề xuất mua hàng
	SELECT A.id, A.sophieu, A.ngaythang, B.FullName AS nguoidexuat, A.noidung
	FROM tr_phieuyeucau_muahang A
		LEFT JOIN SYS_USER B ON A.nguoiyeucau = B.UserName
	WHERE A.sophieu = @sophieu

	-- Table1: Chi tiết phiếu đề xuất mua hàng
	SELECT B.id, B.mact, B.mota, B.quycach, B.mausac, B.dvt, B.soluong, C.dongia, B.ghichu 
	FROM tr_phieuyeucau_muahang A
	INNER JOIN tr_phieuyeucau_muahang_chitiet B ON A.id = B.dexuat_id
	INNER JOIN tr_material C ON B.mact = C.mavt
	WHERE A.sophieu = @sophieu
END

