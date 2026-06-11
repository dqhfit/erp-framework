-- PARAMS:
-- @kieuxem nvarchar
-- @makho nvarchar
-- @trangthai int

CREATE PROCEDURE [dbo].[TR_TONKHO_SUM_GETALL3]
(
  @kieuxem nvarchar(10),
  @makho nvarchar(50),
  @trangthai int
)
AS
BEGIN
	/* trạng thái
	-1: Tất cả
	0: số lượng lớn hơn 0
	1: số lượng nhỏ hơn 0
	2: số lượng bằng 0
	*/
	DECLARE @sql nvarchar(max)
	DECLARE @sql_trangthai nvarchar(2000)
	DECLARE @sql_makho nvarchar(2000)

	IF @trangthai = 0
	  SET @sql_trangthai = ' WHERE A.soluong > 0 '
	ELSE IF @trangthai = 1
	  SET @sql_trangthai = ' WHERE A.soluong < 0 '
	ELSE IF @trangthai = 2
	  SET @sql_trangthai = ' WHERE A.soluong = 0 '
	ELSE IF @trangthai = -1
	  SET @sql_trangthai = ' WHERE A.soluong = A.soluong '

	SET @sql_makho = ' AND (A.makho = ''' + @makho + ''')'

	SET @sql = '
	SELECT A.mavt, B.mota, B.quycach, B.mausac, B.nhom, 
	  B.van_mat1, B.van_mat2, B.tieuchuan, B.van_tieuchuan,
	  B.dvt, B.soluong1kg, B.dacdiem,
	  A.makho, A.soluong, A.soluong_toithieu, A.ghichu, NULL as mancc, NULL as tenncc,
	  B.dayy, B.rong, B.dai
	FROM tr_tonkho_sum A
	  INNER JOIN tr_material B ON A.mavt = B.mavt
	' + @sql_trangthai

	IF @kieuxem = 'WHS'
	BEGIN
	  SET @sql = @sql + @sql_makho + ' ORDER BY B.mota'
	END

	EXECUTE sp_executesql @sql
END
