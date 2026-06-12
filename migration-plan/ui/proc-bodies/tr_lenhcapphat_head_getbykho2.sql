-- PARAMS:
-- @LoaiDonHang nvarchar


CREATE PROC TR_LENHCAPPHAT_HEAD_GETBYKHO2(@LoaiDonHang NVARCHAR(50))
AS
SELECT B.LenhCapPhatID, B.LoaiCapPhat, B.LoaiDonHang
    , B.MaDonDatHang, B.MaDonHang
FROM tr_lenhcapphat_head A
    INNER JOIN tr_lenhcapphat B ON A.LenhCapPhatID = B.LenhCapPhatID
WHERE A.active = 1 AND A.hoanthanh = 0
    AND A.LoaiDonHang = @LoaiDonHang
--GROUP BY B.LenhCapPhatID, B.LoaiCapPhat, B.LoaiDonHang
--    , B.MaDonDatHang, B.MaDonHang
