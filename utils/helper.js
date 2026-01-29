function getPaymentStatus(bill) {
  if (bill.paid_amount >= bill.grand_total) return "PAID";
  if (bill.paid_amount > 0) return "PARTIAL";
  return "DUE";
}
module.exports=getPaymentStatus;