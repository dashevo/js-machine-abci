const {
  abci: {
    ResponseDeliverTx,
  },
} = require('abci/types');

const {
  ApplyStateTransitionRequest,
} = require('@dashevo/drive-grpc');

const createDPPMock = require('@dashevo/dpp/lib/test/mocks/createDPPMock');
const InvalidStateTransitionError = require('@dashevo/dpp/lib/stateTransition/errors/InvalidStateTransitionError');

const deliverTxHandlerFactory = require('../../../../lib/abci/handlers/deliverTxHandlerFactory');
const UpdateStatePromiseClientMock = require('../../../../lib/test/mock/UpdateStatePromiseClientMock');

const getDataContractFixture = require('../../../../lib/test/fixtures/getDataContractFixture');
const getDataContractStateTransitionFixture = require('../../../../lib/test/fixtures/getDataContractStateTransitionFixture');

const BlockchainState = require('../../../../lib/state/BlockchainState');

const InvalidArgumentAbciError = require('../../../../lib/abci/errors/InvalidArgumentAbciError');
const AbciError = require('../../../../lib/abci/errors/AbciError');

describe('deliverTxHandlerFactory', () => {
  let deliverTxHandler;
  let driveUpdateStateClient;
  let request;
  let blockHeight;
  let blockHash;
  let dppMock;
  let blockchainState;
  let stateTransitionFixture;

  beforeEach(async function beforeEach() {
    const dataContractFixture = getDataContractFixture();
    stateTransitionFixture = await getDataContractStateTransitionFixture(dataContractFixture);

    request = {
      tx: stateTransitionFixture.serialize(),
    };

    dppMock = createDPPMock(this.sinon);
    dppMock.stateTransition.createFromSerialized.resolves(stateTransitionFixture);

    blockHeight = 1;
    blockHash = Buffer.alloc(0);

    blockchainState = new BlockchainState(blockHeight);
    driveUpdateStateClient = new UpdateStatePromiseClientMock(this.sinon);

    deliverTxHandler = deliverTxHandlerFactory(
      dppMock,
      driveUpdateStateClient,
      blockchainState,
    );
  });

  it('should apply State Transition and return response with code 0', async () => {
    const response = await deliverTxHandler(request);

    const applyStateTransitionRequest = new ApplyStateTransitionRequest();

    applyStateTransitionRequest.setBlockHeight(blockHeight);
    applyStateTransitionRequest.setBlockHash(blockHash);

    applyStateTransitionRequest.setStateTransition(
      stateTransitionFixture.serialize(),
    );

    expect(response).to.be.an.instanceOf(ResponseDeliverTx);
    expect(response.code).to.equal(0);

    expect(driveUpdateStateClient.applyStateTransition).to.be.calledOnceWith(
      applyStateTransitionRequest,
    );
  });

  it('should throw InvalidArgumentAbciError if State Transition is not specified', async () => {
    try {
      await deliverTxHandler({});

      expect.fail('should throw InvalidArgumentAbciError error');
    } catch (e) {
      expect(e).to.be.instanceOf(InvalidArgumentAbciError);
      expect(e.getMessage()).to.equal('Invalid argument: State Transition is not specified');
      expect(e.getCode()).to.equal(AbciError.CODES.INVALID_ARGUMENT);
    }
  });

  it('should throw InvalidArgumentAbciError if State Transition is invalid', async () => {
    dppMock.stateTransition.createFromSerialized.throws(new InvalidStateTransitionError());

    try {
      await deliverTxHandler(request);

      expect.fail('should throw InvalidArgumentAbciError error');
    } catch (e) {
      expect(e).to.be.instanceOf(InvalidArgumentAbciError);
      expect(e.getMessage()).to.equal('Invalid argument: State Transition is invalid');
      expect(e.getCode()).to.equal(AbciError.CODES.INVALID_ARGUMENT);
    }
  });

  it('should throw the error from createFromSerialized if throws not InvalidStateTransitionError', async () => {
    dppMock.stateTransition.createFromSerialized.throws(new Error('Custom error'));

    try {
      await deliverTxHandler(request);

      expect.fail('should throw an error');
    } catch (e) {
      expect(e).to.be.instanceOf(Error);
      expect(e.message).to.equal('Custom error');
    }
  });
});
