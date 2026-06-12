-- PARAMS:
-- @year int
-- @month int
-- @macongdoan nvarchar


CREATE PROC [dbo].[TR_MUCTIEU_SANXUAT_GETALL2](@year int, @month int, @macongdoan nvarchar(50))
AS
BEGIN
	SELECT A.macongdoan, B.n_op AS tencongdoan,
		A.donhang, A.hehang, 
		muctieu = SUM(A.muctieu),
		D1 = SUM(CASE WHEN DAY(A.ngaythang) = 1 THEN A.muctieu ELSE 0 END),
		D2 = SUM(CASE WHEN DAY(A.ngaythang) = 2 THEN A.muctieu ELSE 0 END),
		D3 = SUM(CASE WHEN DAY(A.ngaythang) = 3 THEN A.muctieu ELSE 0 END),
		D4 = SUM(CASE WHEN DAY(A.ngaythang) = 4 THEN A.muctieu ELSE 0 END),
		D5 = SUM(CASE WHEN DAY(A.ngaythang) = 5 THEN A.muctieu ELSE 0 END),
		D6 = SUM(CASE WHEN DAY(A.ngaythang) = 6 THEN A.muctieu ELSE 0 END),
		D7 = SUM(CASE WHEN DAY(A.ngaythang) = 7 THEN A.muctieu ELSE 0 END),
		D8 = SUM(CASE WHEN DAY(A.ngaythang) = 8 THEN A.muctieu ELSE 0 END),
		D9 = SUM(CASE WHEN DAY(A.ngaythang) = 9 THEN A.muctieu ELSE 0 END),
		D10 = SUM(CASE WHEN DAY(A.ngaythang) = 10 THEN A.muctieu ELSE 0 END),
		D11 = SUM(CASE WHEN DAY(A.ngaythang) = 11 THEN A.muctieu ELSE 0 END),
		D12 = SUM(CASE WHEN DAY(A.ngaythang) = 12 THEN A.muctieu ELSE 0 END),
		D13 = SUM(CASE WHEN DAY(A.ngaythang) = 13 THEN A.muctieu ELSE 0 END),
		D14 = SUM(CASE WHEN DAY(A.ngaythang) = 14 THEN A.muctieu ELSE 0 END),
		D15 = SUM(CASE WHEN DAY(A.ngaythang) = 15 THEN A.muctieu ELSE 0 END),
		D16 = SUM(CASE WHEN DAY(A.ngaythang) = 16 THEN A.muctieu ELSE 0 END),
		D17 = SUM(CASE WHEN DAY(A.ngaythang) = 17 THEN A.muctieu ELSE 0 END),
		D18 = SUM(CASE WHEN DAY(A.ngaythang) = 18 THEN A.muctieu ELSE 0 END),
		D19 = SUM(CASE WHEN DAY(A.ngaythang) = 19 THEN A.muctieu ELSE 0 END),
		D20 = SUM(CASE WHEN DAY(A.ngaythang) = 20 THEN A.muctieu ELSE 0 END),
		D21 = SUM(CASE WHEN DAY(A.ngaythang) = 21 THEN A.muctieu ELSE 0 END),
		D22 = SUM(CASE WHEN DAY(A.ngaythang) = 22 THEN A.muctieu ELSE 0 END),
		D23 = SUM(CASE WHEN DAY(A.ngaythang) = 23 THEN A.muctieu ELSE 0 END),
		D24 = SUM(CASE WHEN DAY(A.ngaythang) = 24 THEN A.muctieu ELSE 0 END),
		D25 = SUM(CASE WHEN DAY(A.ngaythang) = 25 THEN A.muctieu ELSE 0 END),
		D26 = SUM(CASE WHEN DAY(A.ngaythang) = 26 THEN A.muctieu ELSE 0 END),
		D27 = SUM(CASE WHEN DAY(A.ngaythang) = 27 THEN A.muctieu ELSE 0 END),
		D28 = SUM(CASE WHEN DAY(A.ngaythang) = 28 THEN A.muctieu ELSE 0 END),
		D29 = SUM(CASE WHEN DAY(A.ngaythang) = 29 THEN A.muctieu ELSE 0 END),
		D30 = SUM(CASE WHEN DAY(A.ngaythang) = 30 THEN A.muctieu ELSE 0 END),
		D31 = SUM(CASE WHEN DAY(A.ngaythang) = 31 THEN A.muctieu ELSE 0 END)
	FROM tr_muctieu_sanxuat A
		LEFT JOIN trtb_m_op B ON A.macongdoan = B.c_op
	WHERE YEAR(A.ngaythang) = @year AND MONTH(A.ngaythang) = @month AND A.macongdoan = @macongdoan
	GROUP BY A.macongdoan, B.n_op, A.donhang, A.hehang
END


