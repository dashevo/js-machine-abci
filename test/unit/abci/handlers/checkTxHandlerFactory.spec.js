const {
  abci: {
    ResponseCheckTx,
  },
} = require('abci/types');

const DashPlatformProtocol = require('@dashevo/dpp');

const InvalidStateTransitionError = require('@dashevo/dpp/lib/stateTransition/errors/InvalidStateTransitionError');
const ConsensusError = require('@dashevo/dpp/lib/errors/ConsensusError');
const getDocumentFixture = require('@dashevo/dpp/lib/test/fixtures/getDocumentsFixture');
const level = require('level-rocksdb');
const createDPPMock = require('@dashevo/dpp/lib/test/mocks/createDPPMock');
const DocumentsStateTransition = require('@dashevo/dpp/lib/document/stateTransition/DocumentsStateTransition');

const checkTxHandlerFactory = require('../../../../lib/abci/handlers/checkTxHandlerFactory');

const InvalidArgumentAbciError = require('../../../../lib/abci/errors/InvalidArgumentAbciError');
const AbciError = require('../../../../lib/abci/errors/AbciError');
const RateLimiterQuotaExceededAbciError = require(
  '../../../../lib/abci/errors/RateLimiterQuotaExceededAbciError',
);
const RateLimiterUserIsBannedAbciError = require(
  '../../../../lib/abci/errors/RateLimiterUserIsBannedAbciError',
);

const BlockchainState = require('../../../../lib/state/BlockchainState');

const RateLimiterMock = require('../../../../lib/test/mock/RateLimiterMock');

describe('checkTxHandlerFactory', () => {
  let checkTxHandler;
  let request;
  let dppMock;
  let stateTransitionFixture;
  let db;
  let blockchainState;
  let lastBlockHeight;
  let lastBlockAppHash;
  let rateLimiterMock;

  beforeEach(function beforeEach() {
    const dpp = new DashPlatformProtocol();
    const documentFixture = getDocumentFixture();
    stateTransitionFixture = dpp.document.createStateTransition(documentFixture);

    request = {
      tx: stateTransitionFixture.serialize(),
    };

    dppMock = createDPPMock(this.sinon);
    dppMock
      .stateTransition
      .createFromSerialized
      .callsFake(async () => new DocumentsStateTransition(documentFixture));

    rateLimiterMock = new RateLimiterMock(this.sinon);

    checkTxHandler = checkTxHandlerFactory(dppMock, rateLimiterMock, false);

    db = level('./db/state-test', { valueEncoding: 'binary' });

    lastBlockHeight = 1;
    lastBlockAppHash = Buffer.from('something');
    blockchainState = new BlockchainState(lastBlockHeight, lastBlockAppHash);
  });

  afterEach(async () => {
    await db.clear();
    await db.close();
  });

  it('should validate a State Transition and return response with code 0', async () => {
    const response = await checkTxHandler(request, blockchainState);

    expect(response).to.be.an.instanceOf(ResponseCheckTx);
    expect(response.code).to.equal(0);

    expect(dppMock.stateTransition.createFromSerialized).to.be.calledOnceWith(request.tx);
  });

  it('should throw InvalidArgumentAbciError if State Transition is not specified', async () => {
    try {
      await checkTxHandler({}, blockchainState);

      expect.fail('should throw InvalidArgumentAbciError error');
    } catch (e) {
      expect(e).to.be.instanceOf(InvalidArgumentAbciError);
      expect(e.getMessage()).to.equal('Invalid argument: State Transition is not specified');
      expect(e.getCode()).to.equal(AbciError.CODES.INVALID_ARGUMENT);
    }
  });

  it('should throw InvalidArgumentAbciError if State Transition is invalid', async () => {
    const consensusError = new ConsensusError('Invalid state transition');
    const error = new InvalidStateTransitionError(
      [consensusError],
      stateTransitionFixture.toJSON(),
    );

    dppMock.stateTransition.createFromSerialized.throws(error);

    try {
      await checkTxHandler(request, blockchainState);

      expect.fail('should throw InvalidArgumentAbciError error');
    } catch (e) {
      expect(e).to.be.instanceOf(InvalidArgumentAbciError);
      expect(e.getMessage()).to.equal('Invalid argument: State Transition is invalid');
      expect(e.getCode()).to.equal(AbciError.CODES.INVALID_ARGUMENT);
      expect(e.getData()).to.deep.equal({
        errors: [consensusError],
      });
    }
  });

  it('should throw the error from createFromSerialized if throws not InvalidStateTransitionError', async () => {
    const error = new Error('Custom error');
    dppMock.stateTransition.createFromSerialized.throws(error);

    try {
      await checkTxHandler(request, blockchainState);

      expect.fail('should throw an error');
    } catch (e) {
      expect(e).to.be.equal(error);
    }
  });

  describe('with rate limiter', () => {
    it('should validate a State Transition with rate limiter and return response with code 0', async () => {
      checkTxHandler = checkTxHandlerFactory(dppMock, rateLimiterMock, true);

      const response = await checkTxHandler(request, blockchainState);

      expect(response).to.be.an.instanceOf(ResponseCheckTx);
      expect(response.code).to.equal(0);

      expect(dppMock.stateTransition.createFromSerialized).to.be.calledOnceWith(request.tx);
    });

    it('should validate a State Transition with rate limiter and throw quota exceeded error', async () => {
      lastBlockHeight = 11;
      lastBlockAppHash = Buffer.from('something');
      blockchainState = new BlockchainState(lastBlockHeight, lastBlockAppHash);

      rateLimiterMock.getBannedKey.returns('rateLimitedBanKey');
      rateLimiterMock.isQuotaExceeded.resolves(true);

      checkTxHandler = checkTxHandlerFactory(dppMock, rateLimiterMock, true);

      const { userId } = stateTransitionFixture.documents[0];

      try {
        await checkTxHandler(request, blockchainState);
        expect.fail('Error was not thrown');
      } catch (e) {
        expect(e).to.be.an.instanceOf(RateLimiterQuotaExceededAbciError);
        expect(e.getCode()).to.equal(AbciError.CODES.RATE_LIMITER_QUOTA_EXCEEDED);
        expect(e.getUserId()).to.equal(userId);
        expect(e.data).to.deep.equal({ userId });
        expect(e.tags).to.deep.equal({
          rateLimitedBanKey: userId,
          bannedUserIds: userId,
        });
      }
    });

    it('should validate a State Transition with rate limiter and throw user is banned error', async () => {
      lastBlockHeight = 111;
      lastBlockAppHash = Buffer.from('something');
      blockchainState = new BlockchainState(lastBlockHeight, lastBlockAppHash);

      rateLimiterMock.isBannedUser.resolves(true);

      checkTxHandler = checkTxHandlerFactory(dppMock, rateLimiterMock, true);

      const { userId } = stateTransitionFixture.documents[0];

      try {
        await checkTxHandler(request, blockchainState);
        expect.fail('Error was not thrown');
      } catch (e) {
        expect(e).to.be.an.instanceOf(RateLimiterUserIsBannedAbciError);
        expect(e.getCode()).to.equal(AbciError.CODES.RATE_LIMITER_BANNED);
        expect(e.getUserId()).to.equal(userId);
        expect(e.data).to.deep.equal({ userId });
      }
    });
  });
});
