-- PARAMS:
-- @mact nvarchar
-- @khomoi nvarchar

CREATE PROCEDURE [dbo].[TR_TONKHO_SUM_CHUYENKHO]
(
  @mact nvarchar(200),
  @khomoi nvarchar(50)
)
AS
BEGIN TRANSACTION;

BEGIN TRY
  DECLARE @tenkhomoi nvarchar(100)
  IF @khomoi = 'KTV'
    SET @tenkhomoi = N'TẠP VỤ'
  ELSE IF @khomoi = 'HTR'
    SET @tenkhomoi = N'HÀNG TRẮNG'
  ELSE IF @khomoi = 'VPH'
    SET @tenkhomoi = N'VĂN PHÒNG PHẨM'
  ELSE IF @khomoi = 'SON'
    SET @tenkhomoi = N'HÓA CHẤT'
  ELSE IF @khomoi = 'GVA'
    SET @tenkhomoi = N'GỖ VÁN'
  ELSE IF @khomoi = 'NKI'
    SET @tenkhomoi = N'NGŨ KIM'
  ELSE IF @khomoi = 'DGO'
    SET @tenkhomoi = N'BAO BÌ'
  ELSE IF @khomoi = 'BT'
    SET @tenkhomoi = N'BẢO TRÌ'
  ELSE
    SET @tenkhomoi = N'VẬT TƯ KHÁC'
    
  DECLARE @khocu nvarchar(50)
  SELECT @khocu = 
    CASE
        WHEN kho = N'TẠP VỤ' THEN 'KTV'
        WHEN kho = N'HÀNG TRẮNG' THEN 'HTR'
        WHEN kho = N'VĂN PHÒNG PHẨM' THEN 'VPH'
        WHEN kho = N'HÓA CHẤT' THEN 'SON'
        WHEN kho = N'GỖ VÁN' THEN 'GVA'
        WHEN kho = N'NGŨ KIM' THEN 'NKI'
        WHEN kho = N'BAO BÌ' THEN 'DGO'
        WHEN kho = N'BẢO TRÌ' THEN 'BT'
        ELSE 'OTHER'
    END
  FROM tr_material
  WHERE mavt = @mact

  SELECT mavt, SUM(soluong) as soluong
  INTO #SOLUONG_TONKHO
  FROM tr_tonkho_sum
  WHERE mavt = @mact
  GROUP BY mavt

  IF @khomoi != @khocu
  BEGIN
    DELETE tr_tonkho_sum
    WHERE mavt = @mact
    
    DELETE tr_tonkho_chitiet WHERE mavt = @mact

    INSERT INTO tr_tonkho_sum(mavt, makho, soluong, soluong_toithieu)
    SELECT mavt, @khomoi, soluong, 0 
    FROM #SOLUONG_TONKHO
    
    UPDATE tr_material
    SET kho = @tenkhomoi
    WHERE mavt = @mact
  END

  COMMIT;
END TRY
BEGIN CATCH
  ROLLBACK;
END CATCH
