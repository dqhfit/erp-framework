-- PARAMS:
-- @cont_id uniqueidentifier
-- @cont_number nvarchar
-- @cont_name nvarchar
-- @description nvarchar
-- @seal_number nvarchar
-- @order_number nvarchar
-- @cust_po nvarchar
-- @ngaycontve datetime
-- @ngaychatcont datetime
-- @ngayxuat date
-- @trangthai bit
-- @count_print int
-- @remark nvarchar
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @nguoisua nvarchar
-- @ngaysua datetime
-- @IsFinish bit
-- @IsPay bit
-- @sodocont nvarchar
-- @si_id uniqueidentifier
-- @cont_targe float
-- @cont_Gross nvarchar
-- @cont_type nvarchar
-- @vgm_cont_owner nvarchar
-- @PerPONo nvarchar


CREATE PROC [dbo].[TR_CONT_UPDATE2]
(
	@cont_id uniqueidentifier,
	@cont_number nvarchar(200),
	@cont_name nvarchar(MAX),
	@description nvarchar(MAX),
	@seal_number nvarchar(200),
	@order_number nvarchar(MAX),
	@cust_po nvarchar(MAX),
	@ngaycontve datetime,
	@ngaychatcont datetime,
	@ngayxuat date,
	@trangthai bit,
	@count_print int,
	@remark nvarchar(MAX),
	@nguoitao nvarchar(50),
	@ngaytao datetime,
	@nguoisua nvarchar(50),
	@ngaysua datetime,
	@IsFinish bit,
	@IsPay bit,
	@sodocont nvarchar(MAX) = NULL,
	@si_id uniqueidentifier = NULL,
	@cont_targe float = 0,
	@cont_Gross nvarchar(100) = NULL,
	@cont_type nvarchar(255) = NULL,
	@vgm_cont_owner nvarchar(100) = NULL,
	@PerPONo nvarchar(100) = NULL
)
AS
UPDATE tr_cont
SET cont_number = @cont_number,	cont_name = @cont_name,	[description] = @description,	seal_number = @seal_number,	order_number = @order_number,	cust_po = @cust_po,	ngaycontve = @ngaycontve,	ngaychatcont = @ngaychatcont,	ngayxuat = @ngayxuat,	trangthai = @trangthai,	count_print = @count_print,	remark = @remark,	nguoisua = @nguoisua,	ngaysua = @ngaysua,	IsFinish = @IsFinish,	IsPay = @IsPay,	sodocont = @sodocont,	si_id = @si_id,	cont_targe = @cont_targe,	cont_Gross = @cont_Gross,	cont_type = @cont_type,	vgm_cont_owner = @vgm_cont_owner,	PerPONo = @PerPONo
WHERE cont_id = @cont_id

IF EXISTS (SELECT macont FROM tr_ctcont WHERE cont_id = @cont_id)
BEGIN
    UPDATE tr_ctcont
    SET macont = @cont_number
    WHERE cont_id = @cont_id
END

