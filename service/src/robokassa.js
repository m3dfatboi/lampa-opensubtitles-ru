import { hash, timingSafeEqualText } from './utils.js';

function sortedShp(params) {
  return Object.keys(params)
    .filter((key) => /^Shp_/i.test(key))
    .sort()
    .map((key) => `${key}=${params[key]}`);
}

function amountText(value) {
  return Number.parseFloat(value).toFixed(2);
}

function receiptForPackage(config, pkg) {
  if (!config.robokassa.receiptEnabled) return null;

  return {
    sno: config.robokassa.receiptSno,
    items: [
      {
        name: `Кредиты автоперевода: ${pkg.credits}`,
        quantity: 1,
        sum: Number.parseFloat(pkg.price),
        tax: config.robokassa.receiptTax,
        payment_method: 'full_payment',
        payment_object: 'service'
      }
    ]
  };
}

export class Robokassa {
  constructor(config) {
    this.config = config;
  }

  isConfigured() {
    return Boolean(
      this.config.robokassa.merchantLogin &&
      this.config.robokassa.password1 &&
      this.config.robokassa.password2
    );
  }

  paymentSignature({ outSum, invId, shp, receiptEncoded }) {
    const parts = [
      this.config.robokassa.merchantLogin,
      amountText(outSum),
      String(invId)
    ];

    if (receiptEncoded) parts.push(receiptEncoded);

    parts.push(this.config.robokassa.password1, ...sortedShp(shp));
    return hash(this.config.robokassa.hashAlgo, parts.join(':'));
  }

  resultSignature({ outSum, invId, shp }) {
    const parts = [
      String(outSum),
      String(invId),
      this.config.robokassa.password2,
      ...sortedShp(shp)
    ];
    return hash(this.config.robokassa.hashAlgo, parts.join(':'));
  }

  buildPaymentUrl(payment, pkg, user) {
    if (!this.isConfigured()) throw new Error('Robokassa is not configured');

    const shp = {
      Shp_package: pkg.id,
      Shp_user: String(user.id)
    };
    const receipt = receiptForPackage(this.config, pkg);
    const receiptEncoded = receipt ? encodeURIComponent(JSON.stringify(receipt)) : '';
    const signature = this.paymentSignature({
      outSum: pkg.price,
      invId: payment.inv_id,
      shp,
      receiptEncoded
    });
    const params = new URLSearchParams({
      MerchantLogin: this.config.robokassa.merchantLogin,
      OutSum: amountText(pkg.price),
      InvId: String(payment.inv_id),
      Description: `Кредиты автоперевода Lampa: ${pkg.credits}`,
      SignatureValue: signature,
      Culture: 'ru',
      Encoding: 'utf-8',
      ResultURL: `${this.config.publicBaseUrl}/payments/robokassa/result`,
      SuccessURL: `${this.config.publicBaseUrl}/payments/robokassa/success`,
      FailURL: `${this.config.publicBaseUrl}/payments/robokassa/fail`,
      ...shp
    });

    if (this.config.robokassa.test) params.set('IsTest', '1');

    let query = params.toString();
    if (receiptEncoded) query += `&Receipt=${receiptEncoded}`;

    return `https://auth.robokassa.ru/Merchant/Index.aspx?${query}`;
  }

  parseResult(params) {
    const outSum = params.OutSum || params.out_summ || params.outSum;
    const invId = params.InvId || params.InvID || params.inv_id;
    const signature = params.SignatureValue || params.signature || params.crc;
    const shp = {};

    for (const [key, value] of Object.entries(params)) {
      if (/^Shp_/i.test(key)) shp[key] = value;
    }

    if (!outSum || !invId || !signature) throw new Error('Missing Robokassa result params');

    const expected = this.resultSignature({ outSum, invId, shp });
    if (!timingSafeEqualText(expected, signature)) throw new Error('Bad Robokassa signature');

    return {
      invId: Number.parseInt(invId, 10),
      outSumRaw: String(outSum),
      outSum: amountText(outSum),
      shp
    };
  }
}
