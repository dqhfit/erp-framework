-- PARAMS:
-- @MaDonHang nvarchar
-- @MaSP nvarchar
-- @DinhMuc nvarchar
-- @LoaiCapPhat nvarchar


CREATE PROC [dbo].[TR_LENHCAPPHAT_GETLISTBYSP]
(
    @MaDonHang NVARCHAR(100),
    @MaSP NVARCHAR(MAX),
	@DinhMuc NVARCHAR(50),
    @LoaiCapPhat NVARCHAR(50)
)
AS
SELECT A.LenhCapPhatID, A.LoaiDonHang, A.LoaiCapPhat, A.MaDonDatHang, B.master_code, B.masp, B.mavt, 
	C.mota, C.quycach, C.mausac, C.dvt, C.nhom,
	B.soluong, B.soluong_daphat, B.soluong_conlai,
	A.ngaytao
FROM tr_lenhcapphat_head A
	INNER JOIN tr_lenhcapphat B ON A.LenhCapPhatID = B.LenhCapPhatID
	INNER JOIN tr_material C ON B.mavt = C.mavt
WHERE A.active = 1 AND B.active = 1
	AND A.MaDonDatHang = @MaDonHang
	AND	CASE WHEN LEN(B.MaDonDatHang) > 0 THEN B.master_code ELSE B.masp END = @MaSP
	AND A.LoaiDonHang = @DinhMuc
	AND A.LoaiCapPhat = @LoaiCapPhat

