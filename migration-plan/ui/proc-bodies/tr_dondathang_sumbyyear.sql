-- PARAMS:
-- @year int


CREATE PROC TR_DONDATHANG_SUMBYYEAR(@year int)
AS
SELECT A.loaiddh
    , A.mancc
    , A.tenncc
    , ISNULL(B.loaitien, '') AS loaitien
    , A.create_by
    , SUM(B.dongia * B.soluong) AS tongtien
    , SUM(CASE WHEN MONTH(A.ngaydat) = 1 THEN B.dongia * B.soluong ELSE 0 END) AS D1
    , SUM(CASE WHEN MONTH(A.ngaydat) = 2 THEN B.dongia * B.soluong ELSE 0 END) AS D2
    , SUM(CASE WHEN MONTH(A.ngaydat) = 3 THEN B.dongia * B.soluong ELSE 0 END) AS D3
    , SUM(CASE WHEN MONTH(A.ngaydat) = 4 THEN B.dongia * B.soluong ELSE 0 END) AS D4
    , SUM(CASE WHEN MONTH(A.ngaydat) = 5 THEN B.dongia * B.soluong ELSE 0 END) AS D5
    , SUM(CASE WHEN MONTH(A.ngaydat) = 6 THEN B.dongia * B.soluong ELSE 0 END) AS D6
    , SUM(CASE WHEN MONTH(A.ngaydat) = 7 THEN B.dongia * B.soluong ELSE 0 END) AS D7
    , SUM(CASE WHEN MONTH(A.ngaydat) = 8 THEN B.dongia * B.soluong ELSE 0 END) AS D8
    , SUM(CASE WHEN MONTH(A.ngaydat) = 9 THEN B.dongia * B.soluong ELSE 0 END) AS D9
    , SUM(CASE WHEN MONTH(A.ngaydat) = 10 THEN B.dongia * B.soluong ELSE 0 END) AS D10
    , SUM(CASE WHEN MONTH(A.ngaydat) = 11 THEN B.dongia * B.soluong ELSE 0 END) AS D11
    , SUM(CASE WHEN MONTH(A.ngaydat) = 12 THEN B.dongia * B.soluong ELSE 0 END) AS D12
FROM tr_dondathang A
    INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
WHERE A.active = 1
    AND A.pheduyet = 1
    AND YEAR(A.ngaydat) = @year
GROUP BY A.loaiddh
    , A.mancc
    , A.tenncc
    , ISNULL(B.loaitien, '')
    , A.create_by



