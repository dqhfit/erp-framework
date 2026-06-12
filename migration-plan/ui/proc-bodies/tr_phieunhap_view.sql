-- PARAMS:
-- @SoPhieu nvarchar


CREATE PROC TR_PHIEUNHAP_VIEW(@SoPhieu NVARCHAR(50))
AS
SELECT A.maddh, A.sopn
    , B.mavt, C.mota
    , C.quycach, C.mausac, C.dvt
    , soluong = (B.slnhap + soluong_du)
    , D.dongia
FROM tr_phieunhap A
    INNER JOIN tr_ctphieunhap B ON A.sopn = B.sopn
    INNER JOIN tr_material C ON B.mavt = C.mavt
    INNER JOIN (SELECT maddh, chitiet, dongia, SUM(soluong) soluong 
			 FROM tr_dondathang_chitiet WITH(NOLOCK)
			 WHERE active = 1
			 GROUP BY maddh, chitiet, dongia
			 ) D ON B.id_dathang = D.maddh AND D.chitiet = B.mavt
WHERE A.active = 1
    AND C.xoa = 'N'
    AND A.sopn = @SoPhieu

